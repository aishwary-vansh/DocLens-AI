// src/workspaces/workspace.entity.ts
import { randomUUID } from 'crypto';

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

export function createWorkspace(
  name: string,
  userId: string,
  description?: string,
): Workspace {
  return {
    id: randomUUID(),
    name,
    description,
    userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
