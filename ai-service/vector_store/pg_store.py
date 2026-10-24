import hashlib
import json
import logging
import os
import uuid
from typing import Any, Iterable, Optional

import psycopg2
from dotenv import load_dotenv
from pgvector.psycopg2 import register_vector
from psycopg2.extras import Json

from vector_store.text_query import keyword_or_query, scope_filter

load_dotenv()

logger = logging.getLogger(__name__)

BGE_M3_DIMENSIONS = 1024
VALID_ENTITY_TYPES = {"AUTHOR", "CONCEPT", "DATASET", "METHOD", "METRIC", "MODEL", "PAPER"}
VALID_RELATIONSHIP_TYPES = {
    "USES",
    "EVALUATED_ON",
    "REPORTS",
    "COMPARED_WITH",
    "BASED_ON",
    "RELATED_TO",
    "AUTHORED_BY",
    "HAS_CONCEPT",
    "HAS_METHOD",
    "HAS_DATASET",
    "HAS_METRIC",
    "HAS_MODEL",
}


def _json_dict(value: Any) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _normalise_name(value: str) -> str:
    return " ".join((value or "").strip().lower().split()).replace(" ", "_")


class PgStore:
    def __init__(self):
        self.conn_str = os.getenv("DATABASE_URL")
        if not self.conn_str:
            raise ValueError("DATABASE_URL is not set")

    def get_connection(self):
        conn = psycopg2.connect(self.conn_str)
        register_vector(conn)
        return conn

    # -- Document metadata -------------------------------------------------

    def get_document_title(self, document_id: str) -> str:
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT title FROM "Document" WHERE id = %s', (document_id,))
                row = cur.fetchone()
                return row[0] if row else "Unknown Document"
        finally:
            conn.close()

    def get_document_collection_id(self, document_id: str) -> Optional[str]:
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT "collectionId" FROM "Document" WHERE id = %s', (document_id,))
                row = cur.fetchone()
                return row[0] if row else None
        finally:
            conn.close()

    def get_documents(
        self,
        document_ids: Optional[list[str]] = None,
        collection_id: Optional[str] = None,
        limit: int = 30,
    ) -> list[dict]:
        """Load documents (id, title, metadata) by ids, or every indexed paper in a collection."""
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                if document_ids:
                    cur.execute(
                        'SELECT id, title, metadata, "collectionId" FROM "Document" WHERE id = ANY(%s)',
                        (document_ids,),
                    )
                    rows = {row[0]: row for row in cur.fetchall()}
                    ordered = [rows[i] for i in document_ids if i in rows]
                elif collection_id:
                    cur.execute(
                        """
                        SELECT d.id, d.title, d.metadata, d."collectionId" FROM "Document" d
                        WHERE d."collectionId" = %s
                          AND EXISTS (SELECT 1 FROM "DocumentChunk" c WHERE c."documentId" = d.id)
                        ORDER BY d."createdAt" DESC
                        LIMIT %s
                        """,
                        (collection_id, limit),
                    )
                    ordered = cur.fetchall()
                else:
                    return []
                return [
                    {"id": r[0], "title": r[1], "metadata": _json_dict(r[2]), "collectionId": r[3]}
                    for r in ordered
                ]
        finally:
            conn.close()

    def get_chunks_by_ids(self, chunk_ids: list[str]) -> list[dict]:
        if not chunk_ids:
            return []
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT c.id, c."documentId", d.title, c."chunkIndex", c.content, c."pageNumber", c.metadata
                    FROM "DocumentChunk" c JOIN "Document" d ON d.id = c."documentId"
                    WHERE c.id = ANY(%s)
                    """,
                    (list(chunk_ids),),
                )
                rows = {
                    row[0]: {
                        "id": row[0],
                        "documentId": row[1],
                        "documentTitle": row[2],
                        "chunkIndex": row[3],
                        "content": row[4],
                        "pageNumber": row[5],
                        "metadata": _json_dict(row[6]),
                    }
                    for row in cur.fetchall()
                }
                return [rows[i] for i in chunk_ids if i in rows]
        finally:
            conn.close()

    def update_document_ingest_metadata(self, document_id: str, metadata: dict) -> None:
        """Merge extraction metadata into Document.metadata and update page count/title."""
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    'SELECT title, "pageCount", metadata FROM "Document" WHERE id = %s',
                    (document_id,),
                )
                row = cur.fetchone()
                if not row:
                    logger.warning("Document %s not found while updating metadata", document_id)
                    return

                existing_title, _, existing_metadata = row
                merged = {**_json_dict(existing_metadata), **metadata}
                title = (metadata.get("title") or "").strip()

                updates = ['metadata = %s']
                params: list[Any] = [Json(merged)]

                if metadata.get("page_count"):
                    updates.append('"pageCount" = %s')
                    params.append(int(metadata["page_count"]))

                if title and title.lower() not in {"untitled", "unknown"} and title != existing_title:
                    updates.append("title = %s")
                    params.append(title[:500])

                params.append(document_id)
                cur.execute(
                    f'UPDATE "Document" SET {", ".join(updates)} WHERE id = %s',
                    tuple(params),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    # -- Chunks ------------------------------------------------------------

    def insert_chunks(self, chunks: list[dict], document_id: str):
        """
        Upsert chunks and BGE-M3 embeddings into PostgreSQL/pgvector.

        Each chunk must include: content, chunkIndex, pageNumber, embedding, metadata.
        The method also keeps EmbeddingMetadata in sync for citation tracing.
        """
        collection_id = self.get_document_collection_id(document_id)
        if not collection_id:
            raise ValueError(f"Document {document_id} was not found")

        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                chunk_indexes = [int(chunk["chunkIndex"]) for chunk in chunks]
                if chunk_indexes:
                    cur.execute(
                        """
                        DELETE FROM "DocumentChunk"
                        WHERE "documentId" = %s
                          AND NOT ("chunkIndex" = ANY(%s))
                        """,
                        (document_id, chunk_indexes),
                    )

                for chunk in chunks:
                    content = chunk["content"].strip()
                    embedding = chunk.get("embedding")
                    if not content or not embedding:
                        continue
                    if len(embedding) != BGE_M3_DIMENSIONS:
                        raise ValueError(
                            f"Expected {BGE_M3_DIMENSIONS}-dimensional BGE-M3 embedding, "
                            f"got {len(embedding)}"
                        )

                    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
                    token_count = max(1, len(content.split()))

                    cur.execute(
                        """
                        INSERT INTO "DocumentChunk" (
                            id, "documentId", "chunkIndex", content, "pageNumber",
                            embedding, metadata, "tokenCount", "contentHash", "createdAt"
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                        ON CONFLICT ("documentId", "chunkIndex") DO UPDATE SET
                            content = EXCLUDED.content,
                            embedding = EXCLUDED.embedding,
                            "pageNumber" = EXCLUDED."pageNumber",
                            metadata = EXCLUDED.metadata,
                            "tokenCount" = EXCLUDED."tokenCount",
                            "contentHash" = EXCLUDED."contentHash"
                        RETURNING id
                        """,
                        (
                            str(uuid.uuid4()),
                            document_id,
                            int(chunk["chunkIndex"]),
                            content,
                            chunk.get("pageNumber"),
                            embedding,
                            Json(chunk.get("metadata", {})),
                            token_count,
                            content_hash,
                        ),
                    )
                    saved_chunk_id = cur.fetchone()[0]
                    vector_id = f"pgvector:{saved_chunk_id}"

                    cur.execute(
                        """
                        INSERT INTO "EmbeddingMetadata" (
                            id, "modelName", dimensions, "similarityMetric",
                            "vectorStore", "vectorId", "collectionId",
                            "chunkId", "documentId", "createdAt"
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                        ON CONFLICT ("chunkId") DO UPDATE SET
                            "modelName" = EXCLUDED."modelName",
                            dimensions = EXCLUDED.dimensions,
                            "similarityMetric" = EXCLUDED."similarityMetric",
                            "vectorStore" = EXCLUDED."vectorStore",
                            "vectorId" = EXCLUDED."vectorId",
                            "collectionId" = EXCLUDED."collectionId",
                            "documentId" = EXCLUDED."documentId"
                        """,
                        (
                            str(uuid.uuid4()),
                            "BAAI/bge-m3",
                            BGE_M3_DIMENSIONS,
                            "cosine",
                            "pgvector",
                            vector_id,
                            collection_id,
                            saved_chunk_id,
                            document_id,
                        ),
                    )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def get_chunk_fingerprints(self, document_id: str) -> list[dict]:
        """Stored chunk ids, content hashes and the model that produced their vectors."""
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT c.id, c."contentHash",
                           CASE WHEN c.embedding IS NULL THEN NULL ELSE em."modelName" END
                    FROM "DocumentChunk" c
                    LEFT JOIN "EmbeddingMetadata" em ON em."chunkId" = c.id
                    WHERE c."documentId" = %s
                    """,
                    (document_id,),
                )
                return [{"id": r[0], "contentHash": r[1], "embeddingModel": r[2]} for r in cur.fetchall()]
        finally:
            conn.close()

    def insert_ingestion_chunks(self, chunks: list[dict], document_id: str) -> dict:
        """Persist Phase 1 evidence chunks before the embedding phase.

        Re-ingest is an upsert, not delete-all: chunks marked `reuseExisting`
        (see rag.chunking.reconcile_chunk_ids) keep their row id, so Citation
        rows survive; their vector is kept only when `keepEmbedding` is set.
        Rows no longer produced by the parser are deleted (their citations
        cascade, because that text no longer exists).
        """
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT id FROM "DocumentChunk" WHERE "documentId" = %s', (document_id,))
                existing = {row[0] for row in cur.fetchall()}
                reused = [c["id"] for c in chunks if c.get("reuseExisting") and c.get("id") in existing]
                stale = list(existing - set(reused))
                if stale:
                    cur.execute('DELETE FROM "DocumentChunk" WHERE id = ANY(%s)', (stale,))
                if reused:
                    # Move kept rows to negative indexes first so the new order cannot
                    # collide with the ("documentId", "chunkIndex") unique key.
                    cur.execute(
                        'UPDATE "DocumentChunk" SET "chunkIndex" = -1 - "chunkIndex" WHERE id = ANY(%s)',
                        (reused,),
                    )
                reused_set = set(reused)
                for chunk in chunks:
                    content = chunk["content"].strip()
                    content_hash = chunk.get("contentHash") or hashlib.sha256(content.encode("utf-8")).hexdigest()
                    if chunk.get("id") in reused_set:
                        cur.execute(
                            """
                            UPDATE "DocumentChunk"
                            SET "chunkIndex" = %s, content = %s, "pageNumber" = %s, metadata = %s,
                                "tokenCount" = %s, "contentHash" = %s
                            WHERE id = %s AND "documentId" = %s
                            """,
                            (
                                int(chunk["chunkIndex"]),
                                content,
                                chunk.get("pageNumber"),
                                Json(chunk.get("metadata", {})),
                                max(1, len(content.split())),
                                content_hash,
                                chunk["id"],
                                document_id,
                            ),
                        )
                        if not chunk.get("keepEmbedding"):
                            cur.execute('UPDATE "DocumentChunk" SET embedding = NULL WHERE id = %s', (chunk["id"],))
                            cur.execute('DELETE FROM "EmbeddingMetadata" WHERE "chunkId" = %s', (chunk["id"],))
                        continue
                    cur.execute(
                        """
                        INSERT INTO "DocumentChunk" (
                            id, "documentId", "chunkIndex", content, "pageNumber",
                            metadata, "tokenCount", "contentHash", "createdAt"
                        )
                        VALUES (
                            %s, %s, %s, %s, %s, %s, %s, %s, NOW()
                        )
                        """,
                        (
                            chunk.get("id") or str(uuid.uuid4()),
                            document_id,
                            int(chunk["chunkIndex"]),
                            content,
                            chunk.get("pageNumber"),
                            Json(chunk.get("metadata", {})),
                            max(1, len(content.split())),
                            content_hash,
                        ),
                    )
            conn.commit()
            return {"kept": len(reused), "deleted": len(stale), "inserted": len(chunks) - len(reused)}
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def get_document_chunks(self, document_id: str) -> list:
        """Return all chunks for a document, used by KG extraction and evaluation."""
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
                        "id": row[0],
                        "documentId": row[1],
                        "chunkIndex": row[2],
                        "content": row[3],
                        "pageNumber": row[4],
                        "metadata": _json_dict(row[5]),
                    }
                    for row in rows
                ]
        finally:
            conn.close()

    def get_unembedded_chunks(self, document_id: str) -> list:
        """Load persisted Phase 1 chunks that still need embeddings."""
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, "chunkIndex", content, "pageNumber", metadata, "contentHash"
                    FROM "DocumentChunk"
                    WHERE "documentId" = %s AND embedding IS NULL
                    ORDER BY "chunkIndex"
                    """,
                    (document_id,),
                )
                return [
                    {
                        "id": row[0],
                        "chunkIndex": row[1],
                        "content": row[2],
                        "pageNumber": row[3],
                        "metadata": _json_dict(row[4]),
                        "contentHash": row[5],
                    }
                    for row in cur.fetchall()
                ]
        finally:
            conn.close()

    def update_chunk_embeddings(
        self,
        document_id: str,
        chunks: list[dict],
        model_name: str,
    ) -> None:
        """Persist Phase 2 vectors and their citation-tracing metadata."""
        collection_id = self.get_document_collection_id(document_id)
        if not collection_id:
            raise ValueError(f"Document {document_id} was not found")

        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                for chunk in chunks:
                    embedding = chunk.get("embedding")
                    if not embedding:
                        continue
                    if len(embedding) != BGE_M3_DIMENSIONS:
                        raise ValueError(
                            f"Expected {BGE_M3_DIMENSIONS}-dimensional embedding, "
                            f"got {len(embedding)}"
                        )
                    cur.execute(
                        'UPDATE "DocumentChunk" SET embedding = %s WHERE id = %s AND "documentId" = %s',
                        (embedding, chunk["id"], document_id),
                    )
                    cur.execute(
                        """
                        INSERT INTO "EmbeddingMetadata" (
                            id, "modelName", dimensions, "similarityMetric",
                            "vectorStore", "vectorId", "collectionId",
                            "chunkId", "documentId", "createdAt"
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                        ON CONFLICT ("chunkId") DO UPDATE SET
                            "modelName" = EXCLUDED."modelName",
                            dimensions = EXCLUDED.dimensions,
                            "similarityMetric" = EXCLUDED."similarityMetric",
                            "vectorStore" = EXCLUDED."vectorStore",
                            "vectorId" = EXCLUDED."vectorId",
                            "collectionId" = EXCLUDED."collectionId",
                            "documentId" = EXCLUDED."documentId"
                        """,
                        (
                            str(uuid.uuid4()),
                            model_name,
                            BGE_M3_DIMENSIONS,
                            "cosine",
                            "pgvector",
                            f"pgvector:{chunk['id']}",
                            collection_id,
                            chunk["id"],
                            document_id,
                        ),
                    )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    # -- Hybrid RRF search -------------------------------------------------

    def hybrid_search(
        self,
        query: str,
        query_embedding: list,
        collection_id: Optional[str],
        document_ids: Optional[list[str]] = None,
        top_k: int = 40,
        exclude_content_types: Optional[list[str]] = None,
        keyword_query: Optional[str] = None,
        embedding_model: Optional[str] = None,
    ) -> list:
        """Return independent semantic and keyword candidates for Phase 3.

        This deliberately does not fuse or rerank results. RRF belongs to the
        next phase, so each result retains its retrieval source and rank.
        """
        if len(query_embedding) != BGE_M3_DIMENSIONS:
            raise ValueError(
                f"Expected {BGE_M3_DIMENSIONS}-dimensional query embedding, got {len(query_embedding)}"
            )

        base_filter, filter_params = scope_filter(collection_id, document_ids)
        exclude = list(exclude_content_types or [])
        if exclude:
            base_filter += " AND COALESCE(c.metadata->>'content_type', 'page_text') <> ALL(%s)"
            filter_params = (*filter_params, exclude)
        # OR-semantics keyword query: plainto_tsquery ANDs every word, so a
        # natural-language question almost never matched any chunk.
        keyword_text = keyword_query if keyword_query is not None else keyword_or_query(query)
        # Only compare against vectors from the query's embedding model; after a
        # model change, un-reindexed chunks are reachable by keyword only.
        model_clause, model_params = "", ()
        if embedding_model:
            model_clause = (
                ' AND EXISTS (SELECT 1 FROM "EmbeddingMetadata" em'
                ' WHERE em."chunkId" = c.id AND em."modelName" = %s)'
            )
            model_params = (embedding_model,)

        sql = f"""
        WITH semantic_candidates AS (
            SELECT
                c.id, c."documentId", d.title AS "documentTitle",
                c."chunkIndex", c.content, c."pageNumber", c.metadata,
                ROW_NUMBER() OVER (ORDER BY c.embedding <=> %s::vector) AS rank,
                1 - (c.embedding <=> %s::vector) AS similarity
            FROM "DocumentChunk" c
            JOIN "Document" d ON c."documentId" = d.id
            {base_filter} AND c.embedding IS NOT NULL{model_clause}
            ORDER BY c.embedding <=> %s::vector
            LIMIT %s
        ),
        keyword_candidates AS (
            SELECT
                c.id, c."documentId", d.title AS "documentTitle",
                c."chunkIndex", c.content, c."pageNumber", c.metadata,
                ROW_NUMBER() OVER (
                    ORDER BY ts_rank_cd(
                        to_tsvector('english', c.content),
                        websearch_to_tsquery('english', %s), 32
                    ) DESC
                ) AS rank
            FROM "DocumentChunk" c
            JOIN "Document" d ON c."documentId" = d.id
            {base_filter}
              AND to_tsvector('english', c.content) @@ websearch_to_tsquery('english', %s)
            ORDER BY ts_rank_cd(
                to_tsvector('english', c.content),
                websearch_to_tsquery('english', %s), 32
            ) DESC
            LIMIT %s
        )
        SELECT id, "documentId", "documentTitle", "chunkIndex", content,
               "pageNumber", metadata, 'semantic' AS source, rank, similarity
        FROM semantic_candidates
        UNION ALL
        SELECT id, "documentId", "documentTitle", "chunkIndex", content,
               "pageNumber", metadata, 'keyword' AS source, rank, NULL::float AS similarity
        FROM keyword_candidates
        ORDER BY source, rank
        """
        params = (
            query_embedding,
            query_embedding,
            *filter_params,
            *model_params,
            query_embedding,
            top_k,
            keyword_text,
            *filter_params,
            keyword_text,
            keyword_text,
            top_k,
        )

        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                return [
                    {
                        "id": row[0],
                        "documentId": row[1],
                        "documentTitle": row[2],
                        "chunkIndex": row[3],
                        "content": row[4],
                        "pageNumber": row[5],
                        "metadata": _json_dict(row[6]),
                        "retrievalSource": row[7],
                        "retrievalRank": int(row[8]),
                        # BGE-M3 cosine for semantic hits (None for keyword-only
                        # hits); used for the no-relevant-evidence floor.
                        "similarity": float(row[9]) if row[9] is not None else None,
                    }
                    for row in cur.fetchall()
                ]
        finally:
            conn.close()

    def search(
        self,
        query: str,
        query_embedding: list,
        collection_id: Optional[str],
        document_ids: Optional[list[str]] = None,
        top_k: int = 40,
    ) -> list:
        """Hybrid semantic + lexical retrieval with Reciprocal Rank Fusion."""
        if len(query_embedding) != BGE_M3_DIMENSIONS:
            raise ValueError(
                f"Expected {BGE_M3_DIMENSIONS}-dimensional query embedding, got {len(query_embedding)}"
            )

        filter_params: tuple[Any, ...]
        base_filter, filter_params = scope_filter(collection_id, document_ids)

        semantic_filter = f"{base_filter} AND c.embedding IS NOT NULL"

        sql = f"""
        WITH semantic_search AS (
            SELECT
                c.id,
                c."documentId",
                d.title AS "documentTitle",
                c."chunkIndex",
                c.content,
                c."pageNumber",
                c.metadata,
                RANK() OVER (ORDER BY c.embedding <=> %s::vector) AS rank
            FROM "DocumentChunk" c
            JOIN "Document" d ON c."documentId" = d.id
            {semantic_filter}
            ORDER BY c.embedding <=> %s::vector
            LIMIT 100
        ),
        keyword_query AS (
            SELECT plainto_tsquery('english', %s) AS query
        ),
        keyword_search AS (
            SELECT
                c.id,
                c."documentId",
                d.title AS "documentTitle",
                c."chunkIndex",
                c.content,
                c."pageNumber",
                c.metadata,
                RANK() OVER (
                    ORDER BY ts_rank_cd(to_tsvector('english', c.content), keyword_query.query) DESC
                ) AS rank
            FROM "DocumentChunk" c
            JOIN "Document" d ON c."documentId" = d.id
            CROSS JOIN keyword_query
            {base_filter}
            ORDER BY ts_rank_cd(to_tsvector('english', c.content), keyword_query.query) DESC
            LIMIT 100
        )
        SELECT
            COALESCE(s.id, k.id) AS id,
            COALESCE(s."documentId", k."documentId") AS "documentId",
            COALESCE(s."documentTitle", k."documentTitle") AS "documentTitle",
            COALESCE(s."chunkIndex", k."chunkIndex") AS "chunkIndex",
            COALESCE(s.content, k.content) AS content,
            COALESCE(s."pageNumber", k."pageNumber") AS "pageNumber",
            COALESCE(s.metadata, k.metadata) AS metadata,
            COALESCE(1.0 / (60.0 + s.rank), 0.0)
              + COALESCE(1.0 / (60.0 + k.rank), 0.0) AS score
        FROM semantic_search s
        FULL OUTER JOIN keyword_search k ON s.id = k.id
        ORDER BY score DESC
        LIMIT %s
        """

        params = (
            query_embedding,
            *filter_params,
            query_embedding,
            query,
            *filter_params,
            top_k,
        )

        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()
                return [
                    {
                        "id": row[0],
                        "documentId": row[1],
                        "documentTitle": row[2],
                        "chunkIndex": row[3],
                        "content": row[4],
                        "pageNumber": row[5],
                        "metadata": _json_dict(row[6]),
                        "score": float(row[7] or 0.0),
                    }
                    for row in rows
                ]
        finally:
            conn.close()

    # -- Knowledge Graph persistence --------------------------------------

    def insert_entities(self, document_id: str, entities: Iterable[Any]) -> None:
        entities = list(entities)
        if not entities:
            return

        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT "collectionId" FROM "Document" WHERE id = %s', (document_id,))
                row = cur.fetchone()
                if not row:
                    logger.warning("insert_entities: document %s not found", document_id)
                    return
                collection_id = row[0]

                inserted = 0
                for entity in entities:
                    entity_type = entity.entity_type.upper()
                    if entity_type not in VALID_ENTITY_TYPES:
                        logger.debug("Skipping unsupported entity type: %s", entity_type)
                        continue

                    normalized = _normalise_name(entity.normalized_name or entity.name)
                    if not normalized:
                        continue

                    cur.execute(
                        """
                        INSERT INTO "Entity" (
                            id, name, "normalizedName", type, "collectionId",
                            "createdAt", "updatedAt"
                        )
                        VALUES (%s, %s, %s, %s::"EntityType", %s, NOW(), NOW())
                        ON CONFLICT ("collectionId", "normalizedName", type) DO UPDATE SET
                            name = EXCLUDED.name,
                            "updatedAt" = NOW()
                        RETURNING id
                        """,
                        (str(uuid.uuid4()), entity.name, normalized, entity_type, collection_id),
                    )
                    actual_entity_id = cur.fetchone()[0]

                    cur.execute(
                        """
                        INSERT INTO "DocumentEntity" (
                            id, "documentId", "entityId", "mentionCount",
                            pages, confidence, "createdAt"
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, NOW())
                        ON CONFLICT ("documentId", "entityId") DO UPDATE SET
                            "mentionCount" = GREATEST(
                                "DocumentEntity"."mentionCount",
                                EXCLUDED."mentionCount"
                            ),
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
                    inserted += 1

            conn.commit()
            logger.info("Inserted/updated %d entities for document %s", inserted, document_id)
        except Exception as e:
            conn.rollback()
            logger.error("insert_entities failed for document %s: %s", document_id, e)
            raise
        finally:
            conn.close()

    def insert_relationships(self, document_id: str, relationships: Iterable[Any]) -> None:
        relationships = list(relationships)
        if not relationships:
            return

        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT "collectionId" FROM "Document" WHERE id = %s', (document_id,))
                row = cur.fetchone()
                if not row:
                    return
                collection_id = row[0]

                cur.execute('DELETE FROM "Relationship" WHERE "documentId" = %s', (document_id,))

                inserted = 0
                for rel in relationships:
                    relation_type = rel.relation_type.upper()
                    if relation_type not in VALID_RELATIONSHIP_TYPES:
                        relation_type = "RELATED_TO"

                    source_type = rel.source_type.upper()
                    target_type = rel.target_type.upper()
                    if source_type not in VALID_ENTITY_TYPES or target_type not in VALID_ENTITY_TYPES:
                        continue

                    src_norm = _normalise_name(rel.source_name)
                    tgt_norm = _normalise_name(rel.target_name)

                    cur.execute(
                        """
                        SELECT id FROM "Entity"
                        WHERE "collectionId" = %s
                          AND "normalizedName" = %s
                          AND type = %s::"EntityType"
                        LIMIT 1
                        """,
                        (collection_id, src_norm, source_type),
                    )
                    src_row = cur.fetchone()
                    if not src_row:
                        continue

                    cur.execute(
                        """
                        SELECT id FROM "Entity"
                        WHERE "collectionId" = %s
                          AND "normalizedName" = %s
                          AND type = %s::"EntityType"
                        LIMIT 1
                        """,
                        (collection_id, tgt_norm, target_type),
                    )
                    tgt_row = cur.fetchone()
                    if not tgt_row:
                        continue

                    cur.execute(
                        """
                        INSERT INTO "Relationship" (
                            id, type, "collectionId", confidence, metadata,
                            "sourceEntityId", "targetEntityId",
                            "documentId", "evidenceChunkId", "createdAt"
                        )
                        VALUES (%s, %s::"RelationshipType", %s, %s, %s, %s, %s, %s, %s, NOW())
                        """,
                        (
                            str(uuid.uuid4()),
                            relation_type,
                            collection_id,
                            rel.confidence,
                            Json({"evidence_text": rel.evidence_text} if rel.evidence_text else {}),
                            src_row[0],
                            tgt_row[0],
                            document_id,
                            rel.evidence_chunk_id,
                        ),
                    )
                    inserted += 1

            conn.commit()
            logger.info("Inserted %d relationships for document %s", inserted, document_id)
        except Exception as e:
            conn.rollback()
            logger.error("insert_relationships failed for document %s: %s", document_id, e)
            raise
        finally:
            conn.close()

    # -- Knowledge Graph read methods -------------------------------------

    def get_entities(self, collection_id: str, entity_type: str = None, limit: int = 60) -> list:
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                if entity_type:
                    cur.execute(
                        """
                        SELECT e.id, e.name, e."normalizedName", e.type, e."collectionId",
                               COUNT(de."documentId") AS doc_count,
                               SUM(de."mentionCount") AS total_mentions
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
                               COUNT(de."documentId") AS doc_count,
                               SUM(de."mentionCount") AS total_mentions
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
                        "id": row[0],
                        "name": row[1],
                        "normalizedName": row[2],
                        "type": row[3],
                        "collectionId": row[4],
                        "documentCount": row[5] or 0,
                        "totalMentions": int(row[6] or 0),
                    }
                    for row in rows
                ]
        finally:
            conn.close()

    def get_relationships(self, collection_id: str, limit: int = 100) -> list:
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT r.id, r.type, r.confidence,
                           src.name AS source_name, src.type AS source_type,
                           tgt.name AS target_name, tgt.type AS target_type,
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
                        "id": row[0],
                        "type": row[1],
                        "confidence": float(row[2]),
                        "sourceName": row[3],
                        "sourceType": row[4],
                        "targetName": row[5],
                        "targetType": row[6],
                        "documentId": row[7],
                        "evidenceChunkId": row[8],
                        "metadata": _json_dict(row[9]),
                    }
                    for row in rows
                ]
        finally:
            conn.close()


pg_store = PgStore()
