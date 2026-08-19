import os
import psycopg2
import uuid
import json
from pgvector.psycopg2 import register_vector
from dotenv import load_dotenv

load_dotenv()

class PgStore:
    def __init__(self):
        self.conn_str = os.getenv("DATABASE_URL")
        if not self.conn_str:
            raise ValueError("DATABASE_URL is not set")
        
    def get_connection(self):
        conn = psycopg2.connect(self.conn_str)
        register_vector(conn)
        return conn

    def insert_chunks(self, chunks, document_id):
        """
        chunks: list of dicts with keys: content, chunkIndex, pageNumber, embedding
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
                        (chunk_id, document_id, chunk['chunkIndex'], chunk['content'], chunk.get('pageNumber'), chunk['embedding'], json.dumps(chunk.get('metadata', {})))
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

    def search(self, query: str, query_embedding: list, collection_id: str, document_ids=None, top_k=40):
        """
        Hybrid search vector database (BM25 + Dense) using Reciprocal Rank Fusion (RRF).
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
                        "id": row[0],
                        "documentId": row[1],
                        "chunkIndex": row[2],
                        "content": row[3],
                        "pageNumber": row[4],
                        "score": row[5]
                    })
                return results
        finally:
            conn.close()

pg_store = PgStore()
