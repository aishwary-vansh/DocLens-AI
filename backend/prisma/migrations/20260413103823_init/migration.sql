-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'UPLOADED', 'EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING', 'READY', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('AUTHOR', 'CONCEPT', 'DATASET', 'METHOD', 'METRIC', 'MODEL', 'PAPER');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('USES', 'EVALUATED_ON', 'REPORTS', 'COMPARED_WITH', 'BASED_ON', 'RELATED_TO', 'AUTHORED_BY', 'HAS_CONCEPT', 'HAS_METHOD', 'HAS_DATASET', 'HAS_METRIC', 'HAS_MODEL');

-- CreateEnum
CREATE TYPE "ProcessingJobStatus" AS ENUM ('QUEUED', 'ACTIVE', 'RETRYING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "ProcessingStage" AS ENUM ('UPLOADED', 'EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "fileSize" INTEGER,
    "pageCount" INTEGER,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "processingProgress" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "aiProcessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "collectionId" TEXT NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pageNumber" INTEGER,
    "chunkIndex" INTEGER NOT NULL,
    "vectorId" TEXT,
    "tokenCount" INTEGER,
    "contentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentId" TEXT NOT NULL,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbeddingMetadata" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'sentence-transformers',
    "modelName" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "similarityMetric" TEXT NOT NULL DEFAULT 'cosine',
    "vectorStore" TEXT NOT NULL DEFAULT 'faiss',
    "vectorId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chunkId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,

    CONSTRAINT "EmbeddingMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "scopeType" TEXT NOT NULL DEFAULT 'collection',
    "scopeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Query" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "modelUsed" TEXT,
    "retrievalMode" TEXT NOT NULL DEFAULT 'vector',
    "processingMs" INTEGER,
    "rawRequest" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chatSessionId" TEXT NOT NULL,

    CONSTRAINT "Query_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Citation" (
    "id" TEXT NOT NULL,
    "relevance" DOUBLE PRECISION,
    "pageNumber" INTEGER,
    "documentTitle" TEXT,
    "sourceText" TEXT,
    "queryId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,

    CONSTRAINT "Citation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "type" "EntityType" NOT NULL,
    "collectionId" TEXT NOT NULL,
    "externalGraphId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentEntity" (
    "id" TEXT NOT NULL,
    "mentionCount" INTEGER NOT NULL DEFAULT 1,
    "pages" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,

    CONSTRAINT "DocumentEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" TEXT NOT NULL,
    "type" "RelationshipType" NOT NULL,
    "collectionId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceEntityId" TEXT NOT NULL,
    "targetEntityId" TEXT NOT NULL,
    "documentId" TEXT,
    "evidenceChunkId" TEXT,

    CONSTRAINT "Relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL,
    "queueName" TEXT NOT NULL DEFAULT 'document-processing',
    "externalJobId" TEXT,
    "status" "ProcessingJobStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" "ProcessingStage" NOT NULL DEFAULT 'UPLOADED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "payload" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "documentId" TEXT NOT NULL,

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "metricName" TEXT NOT NULL,
    "metricValue" DOUBLE PRECISION NOT NULL,
    "dimensions" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "DocumentChunk_documentId_pageNumber_idx" ON "DocumentChunk"("documentId", "pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentChunk_documentId_chunkIndex_key" ON "DocumentChunk"("documentId", "chunkIndex");

-- CreateIndex
CREATE UNIQUE INDEX "EmbeddingMetadata_vectorId_key" ON "EmbeddingMetadata"("vectorId");

-- CreateIndex
CREATE UNIQUE INDEX "EmbeddingMetadata_chunkId_key" ON "EmbeddingMetadata"("chunkId");

-- CreateIndex
CREATE INDEX "EmbeddingMetadata_collectionId_modelName_idx" ON "EmbeddingMetadata"("collectionId", "modelName");

-- CreateIndex
CREATE INDEX "EmbeddingMetadata_documentId_idx" ON "EmbeddingMetadata"("documentId");

-- CreateIndex
CREATE INDEX "Citation_queryId_idx" ON "Citation"("queryId");

-- CreateIndex
CREATE INDEX "Citation_chunkId_idx" ON "Citation"("chunkId");

-- CreateIndex
CREATE INDEX "Entity_collectionId_type_idx" ON "Entity"("collectionId", "type");

-- CreateIndex
CREATE INDEX "Entity_normalizedName_idx" ON "Entity"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Entity_collectionId_normalizedName_type_key" ON "Entity"("collectionId", "normalizedName", "type");

-- CreateIndex
CREATE INDEX "DocumentEntity_entityId_idx" ON "DocumentEntity"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentEntity_documentId_entityId_key" ON "DocumentEntity"("documentId", "entityId");

-- CreateIndex
CREATE INDEX "Relationship_collectionId_type_idx" ON "Relationship"("collectionId", "type");

-- CreateIndex
CREATE INDEX "Relationship_sourceEntityId_idx" ON "Relationship"("sourceEntityId");

-- CreateIndex
CREATE INDEX "Relationship_targetEntityId_idx" ON "Relationship"("targetEntityId");

-- CreateIndex
CREATE INDEX "Relationship_documentId_idx" ON "Relationship"("documentId");

-- CreateIndex
CREATE INDEX "ProcessingJob_status_stage_idx" ON "ProcessingJob"("status", "stage");

-- CreateIndex
CREATE INDEX "ProcessingJob_documentId_idx" ON "ProcessingJob"("documentId");

-- CreateIndex
CREATE INDEX "ProcessingJob_externalJobId_idx" ON "ProcessingJob"("externalJobId");

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_scopeType_scopeId_metricName_idx" ON "AnalyticsSnapshot"("scopeType", "scopeId", "metricName");

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_capturedAt_idx" ON "AnalyticsSnapshot"("capturedAt");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbeddingMetadata" ADD CONSTRAINT "EmbeddingMetadata_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "DocumentChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbeddingMetadata" ADD CONSTRAINT "EmbeddingMetadata_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Query" ADD CONSTRAINT "Query_chatSessionId_fkey" FOREIGN KEY ("chatSessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "Query"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "DocumentChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentEntity" ADD CONSTRAINT "DocumentEntity_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentEntity" ADD CONSTRAINT "DocumentEntity_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_sourceEntityId_fkey" FOREIGN KEY ("sourceEntityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_targetEntityId_fkey" FOREIGN KEY ("targetEntityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_evidenceChunkId_fkey" FOREIGN KEY ("evidenceChunkId") REFERENCES "DocumentChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
