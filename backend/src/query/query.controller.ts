import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { QueryService } from './query.service';

@ApiTags('Research Intelligence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('query')
export class QueryController {
  constructor(private readonly queryService: QueryService) {}

  @Post('ask')
  @ApiOperation({ summary: 'Citation-aware research chat' })
  ask(
    @Body()
    body: {
      question: string;
      collectionId: string;
      sessionId?: string;
      topK?: number;
      documentIds?: string[];
    },
    @CurrentUser() user: any,
  ) {
    return this.queryService.ask(
      body.question,
      body.collectionId,
      user.id,
      body.sessionId,
      body.topK,
      'vector',
      body.documentIds,
    );
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List persisted research chat sessions' })
  sessions(@CurrentUser() user: any, @Query('collectionId') collectionId?: string) {
    return this.queryService.listSessions(user.id, collectionId);
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Load a persisted chat session with messages and citations' })
  session(@Param('id') id: string, @CurrentUser() user: any) {
    return this.queryService.getSession(id, user.id);
  }

  @Post('search')
  @ApiOperation({ summary: 'Search indexed paper chunks' })
  search(
    @Body()
    body: {
      query: string;
      collectionId: string;
      topK?: number;
      documentIds?: string[];
    },
    @CurrentUser() user: any,
  ) {
    return this.queryService.search(
      body.query,
      body.collectionId,
      body.topK,
      'vector',
      body.documentIds,
      user.id,
    );
  }

  @Post('summarise')
  @ApiOperation({ summary: 'Summarise a document with citations' })
  summarise(@Body() body: { documentId: string }, @CurrentUser() user: any) {
    return this.queryService.summarise(body.documentId, user.id);
  }

  @Post('compare')
  @ApiOperation({ summary: 'Create and store a citation-backed paper comparison' })
  compare(
    @Body()
    body: {
      documentIds?: string[];
      collectionId?: string;
      question?: string;
      topK?: number;
    },
    @CurrentUser() user: any,
  ) {
    return this.queryService.compare(
      body.documentIds ?? [],
      body.collectionId,
      body.question,
      body.topK,
      user.id,
    );
  }

  @Get('comparisons')
  @ApiOperation({ summary: 'List stored comparison history' })
  comparisons(@CurrentUser() user: any, @Query('collectionId') collectionId?: string) {
    return this.queryService.listComparisons(user.id, collectionId);
  }

  @Post('literature-review')
  @ApiOperation({ summary: 'Generate and store a citation-backed literature review' })
  literatureReview(
    @Body()
    body: {
      documentIds: string[];
      collectionId?: string;
      topic?: string;
      title?: string;
    },
    @CurrentUser() user: any,
  ) {
    return this.queryService.generateLiteratureReview({ ...body, userId: user.id });
  }

  @Get('literature-reviews')
  @ApiOperation({ summary: 'List stored literature reviews' })
  literatureReviews(@CurrentUser() user: any, @Query('collectionId') collectionId?: string) {
    return this.queryService.listLiteratureReviews(user.id, collectionId);
  }

  @Get('literature-reviews/:id/export')
  @ApiOperation({ summary: 'Export a literature review as Markdown or PDF' })
  async exportLiteratureReview(
    @Param('id') id: string,
    @Query('format') format: 'markdown' | 'pdf' = 'markdown',
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const artifact = await this.queryService.exportLiteratureReview(id, user.id, format === 'pdf' ? 'pdf' : 'markdown');
    res.setHeader('Content-Type', artifact.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
    res.send(artifact.body);
  }

  @Get('literature-reviews/:id')
  @ApiOperation({ summary: 'Get a stored literature review' })
  getLiteratureReview(@Param('id') id: string, @CurrentUser() user: any) {
    return this.queryService.getLiteratureReview(id, user.id);
  }

  @Get('notes')
  @ApiOperation({ summary: 'List research notes' })
  notes(
    @CurrentUser() user: any,
    @Query('collectionId') collectionId?: string,
    @Query('documentId') documentId?: string,
  ) {
    return this.queryService.listNotes(user.id, collectionId, documentId);
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Get real analytics data' })
  getAnalytics(@CurrentUser() user: any) {
    return this.queryService.getAnalytics(user.id);
  }

  @Post('notes')
  @ApiOperation({ summary: 'Create a research note' })
  createNote(
    @Body()
    body: {
      title: string;
      content: string;
      collectionId?: string;
      documentId?: string;
      scopeType?: string;
      scopeId?: string;
    },
    @CurrentUser() user: any,
  ) {
    return this.queryService.createNote({ ...body, userId: user.id });
  }

  @Patch('notes/:id')
  @ApiOperation({ summary: 'Update a research note' })
  updateNote(@Param('id') id: string, @Body() body: { title?: string; content?: string }, @CurrentUser() user: any) {
    return this.queryService.updateNote(id, user.id, body);
  }

  @Delete('notes/:id')
  @ApiOperation({ summary: 'Delete a research note' })
  deleteNote(@Param('id') id: string, @CurrentUser() user: any) {
    return this.queryService.deleteNote(id, user.id);
  }

  @Get('status/:documentId')
  @ApiOperation({ summary: 'Get processing pipeline status for a document' })
  status(@Param('documentId') documentId: string) {
    return this.queryService.pipelineStatus(documentId);
  }
}
