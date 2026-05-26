import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Workspace } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateWorkspaceDto, userId: string): Promise<Workspace> {
    return this.prisma.workspace.create({
      data: {
        name: dto.name,
        description: dto.description,
        userId,
      },
    });
  }

  async findAllForUser(userId: string): Promise<Workspace[]> {
    return this.prisma.workspace.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string): Promise<Workspace> {
    const workspace = await this.prisma.workspace.findUnique({ where: { id } });
    if (!workspace) throw new NotFoundException(`Workspace ${id} not found`);
    if (workspace.userId !== userId) throw new ForbiddenException('Access denied');
    return workspace;
  }

  async update(id: string, dto: UpdateWorkspaceDto, userId: string): Promise<Workspace> {
    await this.findOne(id, userId);
    return this.prisma.workspace.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
      },
    });
  }

  async remove(id: string, userId: string): Promise<{ id: string }> {
    await this.findOne(id, userId);
    await this.prisma.workspace.delete({ where: { id } });
    return { id };
  }
}
