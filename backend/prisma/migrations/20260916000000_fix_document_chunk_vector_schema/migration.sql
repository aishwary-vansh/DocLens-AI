-- Keep the Prisma schema, raw pgvector store, and BGE-M3 embeddings aligned.
-- BGE-M3 emits 1024-dimensional vectors. Earlier migrations created 384 dims,
-- which made PDF ingestion fail when embeddings were inserted.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "DocumentChunk"
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

ALTER TABLE "DocumentChunk"
  ADD COLUMN IF NOT EXISTS "embedding" vector(1024);

DROP INDEX IF EXISTS "DocumentChunk_embedding_hnsw_idx";

-- Existing 384-dimensional vectors cannot be losslessly converted to 1024
-- dimensions, so clear stale values and let reindexing repopulate them.
ALTER TABLE "DocumentChunk"
  ALTER COLUMN "embedding" TYPE vector(1024)
  USING NULL::vector(1024);

CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
  ON "DocumentChunk"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);

ALTER TABLE "EmbeddingMetadata"
  ALTER COLUMN "vectorStore" SET DEFAULT 'pgvector';
