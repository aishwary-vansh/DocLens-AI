import { Injectable, NotFoundException } from '@nestjs/common';
import { Collection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';

@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  async create(dto: CreateCollectionDto, userId: string): Promise<Collection> {
    await this.workspacesService.findOne(dto.workspaceId, userId);
    return this.prisma.collection.create({
      data: {
        name: dto.name,
        description: dto.description,
        workspaceId: dto.workspaceId,
      },
    });
  }

  async findByWorkspace(workspaceId: string, userId: string): Promise<Collection[]> {
    await this.workspacesService.findOne(workspaceId, userId);
    return this.prisma.collection.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string): Promise<Collection> {
    const collection = await this.prisma.collection.findUnique({
      where: { id },
      include: { workspace: true },
    });
    if (!collection) throw new NotFoundException(`Collection ${id} not found`);
    await this.workspacesService.findOne(collection.workspaceId, userId);
    return collection;
  }

  async update(id: string, dto: UpdateCollectionDto, userId: string): Promise<Collection> {
    await this.findOne(id, userId);
    return this.prisma.collection.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
      },
    });
  }

  async remove(id: string, userId: string): Promise<{ id: string }> {
    await this.findOne(id, userId);
    await this.prisma.collection.delete({ where: { id } });
    return { id };
  }
}
