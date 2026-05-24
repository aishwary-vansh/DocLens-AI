// src/documents/document.entity.ts
import { randomUUID } from 'crypto';

export type DocumentStatus =
  | 'PENDING'
  | 'EXTRACTING'
  | 'CHUNKING'
  | 'EMBEDDING'
  | 'COMPLETED'
  | 'FAILED';

export interface Document {
  id: string;
  title: string;
  filename: string;     // original name
  fileUrl: string;      // path relative to server root: uploads/<userId>/<file>
  mimeType: string;
  fileSize: number;
  pageCount?: number;
  status: DocumentStatus;
  errorMessage?: string;
  collectionId: string;
  createdAt: Date;
  updatedAt: Date;
}

export function createDocument(
  title: string,
  filename: string,
  fileUrl: string,
  fileSize: number,
  collectionId: string,
  mimeType = 'application/pdf',
): Document {
  return {
    id: randomUUID(),
    title,
    filename,
    fileUrl,
    mimeType,
    fileSize,
    status: 'PENDING',
    collectionId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
