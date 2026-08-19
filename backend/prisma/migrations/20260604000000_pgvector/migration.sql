-- Enable PgVector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to DocumentChunk
ALTER TABLE "DocumentChunk" ADD COLUMN IF NOT EXISTS "embedding" vector(384);

-- HNSW index for cosine similarity on unit-norm vectors
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
  ON "DocumentChunk"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);
