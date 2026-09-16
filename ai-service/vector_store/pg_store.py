import os
import psycopg2
import uuid
import json
import logging
from pgvector.psycopg2 import register_vector
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


class PgStore:
    def __init__(self):
        self.conn_str = os.getenv("DATABASE_URL")
        if not self.conn_str:
            raise ValueError("DATABASE_URL is not set")

    def get_connection(self):
        conn = psycopg2.connect(self.conn_str)
        register_vector(conn)
        return conn

    # ── Chunks ────────────────────────────────────────────────────────────────

    def insert_chunks(self, chunks, document_id):
        """
        chunks: list of dicts with keys: content, chunkIndex, pageNumber, embedding
        Existing logic preserved unchanged.
        """
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                for chunk in chunks:
                    chunk_id = str(uuid.uuid4())
                    cur.execute(
                        """
                        INSERT INTO "DocumentChunk" (id, "documentId", "chunkIndex", content, "pageNumber", embedding, metadata, "createdAt")
                        VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                        ON CONFLICT ("documentId", "chunkIndex") DO UPDATE SET
                        content = EXCLUDED.content,
                        embedding = EXCLUDED.embedding,
                        "pageNumber" = EXCLUDED."pageNumber",
                        metadata = EXCLUDED.metadata
                        """,
                        (
                            chunk_id,
                            document_id,
                            chunk['chunkIndex'],
                            chunk['content'],
                            chunk.get('pageNumber'),
                            chunk['embedding'],
                            json.dumps(chunk.get('metadata', {})),
                        ),
                    )
            conn.commit()
        finally:
            conn.close()

    def get_document_title(self, document_id: str) -> str:
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT title FROM "Document" WHERE id = %s', (document_id,))
                row = cur.fetchone()
                return row[0] if row else "Unknown Document"
        finally:
            conn.close()

    def get_document_chunks(self, document_id: str) -> list:
        """Return all chunks for a document (used by KG extraction and evaluation)."""
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, "documentId", "chunkIndex", content, "pageNumber", metadata
                    FROM "DocumentChunk"
                    WHERE "documentId" = %s
                    ORDER BY "chunkIndex"
                    """,
                    (document_id,),
                )
                rows = cur.fetchall()
                return [
                    {
                        "id":         row[0],
                        "documentId": row[1],
                        "chunkIndex": row[2],
                        "content":    row[3],
                        "pageNumber": row[4],
                        "metadata":   row[5] or {},
                    }
                    for row in rows
                ]
        finally:
            conn.close()

    # ── Hybrid RRF Search (UNCHANGED) ─────────────────────────────────────────

    def search(self, query: str, query_embedding: list, collection_id: str, document_ids=None, top_k=40):
        """
        Hybrid search vector database (BM25 + Dense) using Reciprocal Rank Fusion (RRF).
        THIS SQL IS UNCHANGED — wrapped by DocLensRetriever in rag/retriever.py.
        """
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                if document_ids and len(document_ids) > 0:
                    where_clause = 'WHERE c."documentId" = ANY(%s)'
                    params_semantic = (query_embedding, document_ids, query_embedding)
                    params_keyword = (query, document_ids, query)
                else:
                    where_clause = 'JOIN "Document" d ON c."documentId" = d.id WHERE d."collectionId" = %s'
                    params_semantic = (query_embedding, collection_id, query_embedding)
                    params_keyword = (query, collection_id, query)

                sql = f"""
                WITH semantic_search AS (
                    SELECT c.id, c."documentId", c."chunkIndex", c.content, c."pageNumber",
                    RANK() OVER (ORDER BY c.embedding <=> %s::vector) AS rank
                    FROM "DocumentChunk" c
                    {where_clause}
                    ORDER BY c.embedding <=> %s::vector
                    LIMIT 100
                ),
                keyword_search AS (
                    SELECT c.id, c."documentId", c."chunkIndex", c.content, c."pageNumber",
                    RANK() OVER (ORDER BY ts_rank_cd(to_tsvector('english', c.content), plainto_tsquery('english', %s)) DESC) AS rank
                    FROM "DocumentChunk" c
                    {where_clause}
                    ORDER BY ts_rank_cd(to_tsvector('english', c.content), plainto_tsquery('english', %s)) DESC
                    LIMIT 100
                )
                SELECT
                    COALESCE(s.id, k.id) as id,
                    COALESCE(s."documentId", k."documentId") as "documentId",
                    COALESCE(s."chunkIndex", k."chunkIndex") as "chunkIndex",
                    COALESCE(s.content, k.content) as content,
                    COALESCE(s."pageNumber", k."pageNumber") as "pageNumber",
                    COALESCE(1.0 / (60.0 + s.rank), 0.0) + COALESCE(1.0 / (60.0 + k.rank), 0.0) AS score
                FROM semantic_search s
                FULL OUTER JOIN keyword_search k ON s.id = k.id
                ORDER BY score DESC
                LIMIT %s
                """

                cur.execute(sql, params_semantic + params_keyword + (top_k,))
                rows = cur.fetchall()
                results = []
                for row in rows:
                    results.append({
                        "id":         row[0],
                        "documentId": row[1],
                        "chunkIndex": row[2],
                        "content":    row[3],
                        "pageNumber": row[4],
                        "score":      row[5],
                    })
                return results
        finally:
            conn.close()

    # ── Knowledge Graph — Entity persistence ─────────────────────────────────

    def insert_entities(self, document_id: str, entities: list) -> None:
        """
        Upsert KG entities extracted from a document into the Prisma-managed
        Entity and DocumentEntity tables.

        entities: list of KGEntity objects (from rag/schemas.py)
        """
        if not entities:
            return

        # Resolve collection_id for this document
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    'SELECT c."collectionId" FROM "Document" d JOIN "Collection" c ON d."collectionId" = c.id WHERE d.id = %s',
                    (document_id,),
                )
                row = cur.fetchone()
                if not row:
                    logger.warning("insert_entities: document %s not found", document_id)
                    return
                collection_id = row[0]

                for entity in entities:
                    entity_type = entity.entity_type.upper()
                    normalized = entity.normalized_name.lower().replace(" ", "_")
                    entity_id = str(uuid.uuid4())

                    # Upsert into Entity table
                    cur.execute(
                        """
                        INSERT INTO "Entity" (id, name, "normalizedName", type, "collectionId", "createdAt", "updatedAt")
                        VALUES (%s, %s, %s, %s::"EntityType", %s, NOW(), NOW())
                        ON CONFLICT ("collectionId", "normalizedName", type) DO UPDATE SET
                            name = EXCLUDED.name,
                            "updatedAt" = NOW()
                        RETURNING id
                        """,
                        (entity_id, entity.name, normalized, entity_type, collection_id),
                    )
                    returned = cur.fetchone()
                    actual_entity_id = returned[0] if returned else entity_id

                    # Upsert into DocumentEntity (mention tracking)
                    cur.execute(
                        """
                        INSERT INTO "DocumentEntity" (id, "documentId", "entityId", "mentionCount", pages, confidence, "createdAt")
                        VALUES (%s, %s, %s, %s, %s, %s, NOW())
                        ON CONFLICT ("documentId", "entityId") DO UPDATE SET
                            "mentionCount" = "DocumentEntity"."mentionCount" + EXCLUDED."mentionCount",
                            pages = EXCLUDED.pages,
                            confidence = GREATEST("DocumentEntity".confidence, EXCLUDED.confidence)
                        """,
                        (
                            str(uuid.uuid4()),
                            document_id,
                            actual_entity_id,
                            entity.mentions,
                            entity.pages,
                            entity.confidence,
                        ),
                    )

            conn.commit()
            logger.info("Inserted %d entities for document %s", len(entities), document_id)
        except Exception as e:
            conn.rollback()
            logger.error("insert_entities failed for document %s: %s", document_id, e)
            raise
        finally:
            conn.close()

    # ── Knowledge Graph — Relationship persistence ────────────────────────────

    def insert_relationships(self, document_id: str, relationships: list) -> None:
        """
        Upsert KG relationships into the Prisma-managed Relationship table.
        Each relationship references source/target Entity rows and optionally
        an evidence DocumentChunk.

        relationships: list of KGRelationship objects (from rag/schemas.py)
        """
        if not relationships:
            return

        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                # Resolve collection_id
                cur.execute(
                    'SELECT "collectionId" FROM "Document" WHERE id = %s',
                    (document_id,),
                )
                row = cur.fetchone()
                if not row:
                    return
                collection_id = row[0]

                for rel in relationships:
                    # Look up source and target entity IDs by normalised name + type
                    src_norm = rel.source_name.lower().replace(" ", "_")
                    tgt_norm = rel.target_name.lower().replace(" ", "_")

                    cur.execute(
                        """
                        SELECT id FROM "Entity"
                        WHERE "collectionId" = %s AND "normalizedName" = %s AND type = %s::"EntityType"
                        LIMIT 1
                        """,
                        (collection_id, src_norm, rel.source_type.upper()),
                    )
                    src_row = cur.fetchone()
                    if not src_row:
                        logger.debug("Relationship source entity not found: %s (%s)", src_norm, rel.source_type)
                        continue

                    cur.execute(
                        """
                        SELECT id FROM "Entity"
                        WHERE "collectionId" = %s AND "normalizedName" = %s AND type = %s::"EntityType"
                        LIMIT 1
                        """,
                        (collection_id, tgt_norm, rel.target_type.upper()),
                    )
                    tgt_row = cur.fetchone()
                    if not tgt_row:
                        logger.debug("Relationship target entity not found: %s (%s)", tgt_norm, rel.target_type)
                        continue

                    cur.execute(
                        """
                        INSERT INTO "Relationship" (
                            id, type, "collectionId", confidence, metadata,
                            "sourceEntityId", "targetEntityId",
                            "documentId", "evidenceChunkId", "createdAt"
                        )
                        VALUES (%s, %s::"RelationshipType", %s, %s, %s, %s, %s, %s, %s, NOW())
                        ON CONFLICT DO NOTHING
                        """,
                        (
                            str(uuid.uuid4()),
                            rel.relation_type.upper(),
                            collection_id,
                            rel.confidence,
                            json.dumps({"evidence_text": rel.evidence_text} if rel.evidence_text else {}),
                            src_row[0],
                            tgt_row[0],
                            document_id,
                            rel.evidence_chunk_id,
                        ),
                    )

            conn.commit()
            logger.info("Inserted %d relationships for document %s", len(relationships), document_id)
        except Exception as e:
            conn.rollback()
            logger.error("insert_relationships failed for document %s: %s", document_id, e)
            raise
        finally:
            conn.close()

    # ── Knowledge Graph — Read methods ────────────────────────────────────────

    def get_entities(self, collection_id: str, entity_type: str = None, limit: int = 60) -> list:
        """Read entities for a collection, optionally filtered by type."""
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                if entity_type:
                    cur.execute(
                        """
                        SELECT e.id, e.name, e."normalizedName", e.type, e."collectionId",
                               COUNT(de."documentId") as doc_count,
                               SUM(de."mentionCount") as total_mentions
                        FROM "Entity" e
                        LEFT JOIN "DocumentEntity" de ON de."entityId" = e.id
                        WHERE e."collectionId" = %s AND e.type = %s::"EntityType"
                        GROUP BY e.id, e.name, e."normalizedName", e.type, e."collectionId"
                        ORDER BY total_mentions DESC NULLS LAST
                        LIMIT %s
                        """,
                        (collection_id, entity_type.upper(), limit),
                    )
                else:
                    cur.execute(
                        """
                        SELECT e.id, e.name, e."normalizedName", e.type, e."collectionId",
                               COUNT(de."documentId") as doc_count,
                               SUM(de."mentionCount") as total_mentions
                        FROM "Entity" e
                        LEFT JOIN "DocumentEntity" de ON de."entityId" = e.id
                        WHERE e."collectionId" = %s
                        GROUP BY e.id, e.name, e."normalizedName", e.type, e."collectionId"
                        ORDER BY total_mentions DESC NULLS LAST
                        LIMIT %s
                        """,
                        (collection_id, limit),
                    )
                rows = cur.fetchall()
                return [
                    {
                        "id":              row[0],
                        "name":            row[1],
                        "normalizedName":  row[2],
                        "type":            row[3],
                        "collectionId":    row[4],
                        "documentCount":   row[5] or 0,
                        "totalMentions":   int(row[6] or 0),
                    }
                    for row in rows
                ]
        finally:
            conn.close()

    def get_relationships(self, collection_id: str, limit: int = 100) -> list:
        """Read relationships for a collection with source/target entity names."""
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT r.id, r.type, r.confidence,
                           src.name as source_name, src.type as source_type,
                           tgt.name as target_name, tgt.type as target_type,
                           r."documentId", r."evidenceChunkId",
                           r.metadata
                    FROM "Relationship" r
                    JOIN "Entity" src ON r."sourceEntityId" = src.id
                    JOIN "Entity" tgt ON r."targetEntityId" = tgt.id
                    WHERE r."collectionId" = %s
                    ORDER BY r.confidence DESC
                    LIMIT %s
                    """,
                    (collection_id, limit),
                )
                rows = cur.fetchall()
                return [
                    {
                        "id":              row[0],
                        "type":            row[1],
                        "confidence":      float(row[2]),
                        "sourceName":      row[3],
                        "sourceType":      row[4],
                        "targetName":      row[5],
                        "targetType":      row[6],
                        "documentId":      row[7],
                        "evidenceChunkId": row[8],
                        "metadata":        row[9] or {},
                    }
                    for row in rows
                ]
        finally:
            conn.close()


pg_store = PgStore()
