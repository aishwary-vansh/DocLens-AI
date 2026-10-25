// src/collections/collections.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
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
  ApiQuery,
} from '@nestjs/swagger';
import { CollectionsService } from './collections.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Collections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('collections')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  // ─── POST /collections ────────────────────────────────────────────────────
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new collection within a workspace' })
  @ApiCreatedResponse({ description: 'Collection created' })
  create(@Body() dto: CreateCollectionDto, @CurrentUser() user: any) {
    return this.collectionsService.create(dto, user.id);
  }

  // ─── GET /collections?workspaceId=xxx ─────────────────────────────────────
  @Get()
  @ApiOperation({ summary: 'List collections for a given workspace' })
  @ApiOkResponse({ description: 'Array of collections' })
  @ApiQuery({ name: 'workspaceId', required: true })
  findAll(@Query('workspaceId') workspaceId: string, @CurrentUser() user: any) {
    return this.collectionsService.findByWorkspace(workspaceId, user.id);
  }

  // ─── GET /collections/:id ─────────────────────────────────────────────────
  @Get(':id')
  @ApiOperation({ summary: 'Get a single collection' })
  @ApiOkResponse({ description: 'Collection object' })
  @ApiNotFoundResponse({ description: 'Collection not found' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.collectionsService.findOne(id, user.id);
  }

  // ─── PATCH /collections/:id ───────────────────────────────────────────────
  @Patch(':id')
  @ApiOperation({ summary: 'Update a collection' })
  @ApiOkResponse({ description: 'Updated collection' })
  @ApiNotFoundResponse({ description: 'Collection not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCollectionDto,
    @CurrentUser() user: any,
  ) {
    return this.collectionsService.update(id, dto, user.id);
  }

  // ─── DELETE /collections/:id ──────────────────────────────────────────────
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a collection and all its documents' })
  @ApiOkResponse({ description: '{ id } of deleted collection' })
  @ApiNotFoundResponse({ description: 'Collection not found' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.collectionsService.remove(id, user.id);
  }
}
