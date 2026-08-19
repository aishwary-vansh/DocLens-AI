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

    def search(self, query_embedding, collection_id, document_ids=None, top_k=5):
        """
        Search vector database for closest chunks.
        """
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                if document_ids and len(document_ids) > 0:
                    cur.execute(
                        """
                        SELECT c.id, c."documentId", c."chunkIndex", c.content, c."pageNumber", 
                        1 - (c.embedding <=> %s::vector) AS score
                        FROM "DocumentChunk" c
                        WHERE c."documentId" = ANY(%s)
                        ORDER BY c.embedding <=> %s::vector
                        LIMIT %s
                        """,
                        (query_embedding, document_ids, query_embedding, top_k)
                    )
                else:
                    cur.execute(
                        """
                        SELECT c.id, c."documentId", c."chunkIndex", c.content, c."pageNumber", 
                        1 - (c.embedding <=> %s::vector) AS score
                        FROM "DocumentChunk" c
                        JOIN "Document" d ON c."documentId" = d.id
                        WHERE d."collectionId" = %s
                        ORDER BY c.embedding <=> %s::vector
                        LIMIT %s
                        """,
                        (query_embedding, collection_id, query_embedding, top_k)
                    )
                
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
