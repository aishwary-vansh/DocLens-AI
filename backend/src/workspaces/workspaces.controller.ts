// src/workspaces/workspaces.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Workspaces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  // ─── POST /workspaces ─────────────────────────────────────────────────────
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new workspace' })
  @ApiCreatedResponse({ description: 'Workspace created' })
  create(@Body() dto: CreateWorkspaceDto, @CurrentUser() user: any) {
    return this.workspacesService.create(dto, user.id);
  }

  // ─── GET /workspaces ──────────────────────────────────────────────────────
  @Get()
  @ApiOperation({ summary: 'List all workspaces belonging to the authenticated user' })
  @ApiOkResponse({ description: 'Array of workspaces' })
  findAll(@CurrentUser() user: any) {
    return this.workspacesService.findAllForUser(user.id);
  }

  // ─── GET /workspaces/:id ──────────────────────────────────────────────────
  @Get(':id')
  @ApiOperation({ summary: 'Get a single workspace by ID' })
  @ApiOkResponse({ description: 'Workspace object' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.workspacesService.findOne(id, user.id);
  }

  // ─── PATCH /workspaces/:id ────────────────────────────────────────────────
  @Patch(':id')
  @ApiOperation({ summary: 'Update workspace name/description' })
  @ApiOkResponse({ description: 'Updated workspace' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWorkspaceDto,
    @CurrentUser() user: any,
  ) {
    return this.workspacesService.update(id, dto, user.id);
  }

  // ─── DELETE /workspaces/:id ───────────────────────────────────────────────
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a workspace and all its collections/documents' })
  @ApiOkResponse({ description: '{ id } of deleted workspace' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.workspacesService.remove(id, user.id);
  }
}
