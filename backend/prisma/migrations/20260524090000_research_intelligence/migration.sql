-- Add product persistence for comparison history, literature reviews, notes, and reading progress.

ALTER TABLE "Query" ALTER COLUMN "retrievalMode" SET DEFAULT 'vector';

CREATE TABLE "PaperComparison" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "question" TEXT,
    "documentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "result" JSONB NOT NULL,
    "markdown" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "collectionId" TEXT,

    CONSTRAINT "PaperComparison_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiteratureReview" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT,
    "documentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sections" JSONB NOT NULL,
    "markdown" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "collectionId" TEXT,

    CONSTRAINT "LiteratureReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchNote" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL DEFAULT 'collection',
    "scopeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "collectionId" TEXT,
    "documentId" TEXT,

    CONSTRAINT "ResearchNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReadingProgress" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNREAD',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "lastReadPage" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,

    CONSTRAINT "ReadingProgress_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaperComparison_userId_createdAt_idx" ON "PaperComparison"("userId", "createdAt");
CREATE INDEX "PaperComparison_collectionId_idx" ON "PaperComparison"("collectionId");

CREATE INDEX "LiteratureReview_userId_createdAt_idx" ON "LiteratureReview"("userId", "createdAt");
CREATE INDEX "LiteratureReview_collectionId_idx" ON "LiteratureReview"("collectionId");

CREATE INDEX "ResearchNote_userId_updatedAt_idx" ON "ResearchNote"("userId", "updatedAt");
CREATE INDEX "ResearchNote_scopeType_scopeId_idx" ON "ResearchNote"("scopeType", "scopeId");
CREATE INDEX "ResearchNote_collectionId_idx" ON "ResearchNote"("collectionId");
CREATE INDEX "ResearchNote_documentId_idx" ON "ResearchNote"("documentId");

CREATE UNIQUE INDEX "ReadingProgress_userId_documentId_key" ON "ReadingProgress"("userId", "documentId");
CREATE INDEX "ReadingProgress_userId_updatedAt_idx" ON "ReadingProgress"("userId", "updatedAt");
CREATE INDEX "ReadingProgress_documentId_idx" ON "ReadingProgress"("documentId");

ALTER TABLE "PaperComparison" ADD CONSTRAINT "PaperComparison_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaperComparison" ADD CONSTRAINT "PaperComparison_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LiteratureReview" ADD CONSTRAINT "LiteratureReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiteratureReview" ADD CONSTRAINT "LiteratureReview_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ResearchNote" ADD CONSTRAINT "ResearchNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchNote" ADD CONSTRAINT "ResearchNote_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResearchNote" ADD CONSTRAINT "ResearchNote_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReadingProgress" ADD CONSTRAINT "ReadingProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReadingProgress" ADD CONSTRAINT "ReadingProgress_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
