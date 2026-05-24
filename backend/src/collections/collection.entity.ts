// src/collections/collection.entity.ts
import { randomUUID } from 'crypto';

export interface Collection {
  id: string;
  name: string;
  description?: string;
  workspaceId: string;
  createdAt: Date;
  updatedAt: Date;
}

export function createCollection(
  name: string,
  workspaceId: string,
  description?: string,
): Collection {
  return {
    id: randomUUID(),
    name,
    description,
    workspaceId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
