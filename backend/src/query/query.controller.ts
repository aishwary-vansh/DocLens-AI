import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ResearchGapsDto } from './dto/research-gaps.dto';
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
      clientRequestId?: string;
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
      { clientRequestId: cleanRequestId(body.clientRequestId) },
    );
  }

  @Post('ask/stream')
  @ApiOperation({ summary: 'Research chat with Server-Sent Events progress (stage, result, error)' })
  async askStream(
    @Body()
    body: {
      question: string;
      collectionId: string;
      sessionId?: string;
      topK?: number;
      documentIds?: string[];
      clientRequestId?: string;
    },
    @CurrentUser() user: any,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // nginx must not buffer SSE
    res.flushHeaders();

    const controller = new AbortController();
    // 'close' on the response fires when the client goes away before we finish.
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    const send = (event: string, data: unknown) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const keepAlive = setInterval(() => !res.writableEnded && res.write(': keep-alive\n\n'), 15_000);

    send('stage', { stage: 'queued' });
    try {
      const result = await this.queryService.ask(
        body.question,
        body.collectionId,
        user.id,
        body.sessionId,
        body.topK,
        'vector',
        body.documentIds,
        {
          clientRequestId: cleanRequestId(body.clientRequestId),
          signal: controller.signal,
          onStage: (stage) => send('stage', { stage }),
        },
      );
      send('result', result);
    } catch (err: any) {
      if (!controller.signal.aborted) {
        send('error', { statusCode: err?.status ?? 500, message: err?.message ?? 'The research query failed.' });
      }
    } finally {
      clearInterval(keepAlive);
      if (!res.writableEnded) res.end();
    }
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

  @Post('search/hybrid')
  @ApiOperation({ summary: 'Phase 3 hybrid semantic and keyword candidates' })
  hybridSearch(
    @Body()
    body: {
      query: string;
      collectionId: string;
      topK?: number;
      documentIds?: string[];
    },
    @CurrentUser() user: any,
  ) {
    return this.queryService.hybridSearch(
      body.query,
      body.collectionId,
      body.topK,
      body.documentIds,
      user.id,
    );
  }

  @Post('summarise')
  @ApiOperation({ summary: 'Summarise a document with citations' })
  summarise(@Body() body: { documentId: string }, @CurrentUser() user: any) {
    return this.queryService.summarise(body.documentId, user.id);
  }

  @Post('review')
  @ApiOperation({ summary: 'AI Reviewer — structured peer-review style analysis of a paper' })
  review(@Body() body: { documentId: string }, @CurrentUser() user: any) {
    return this.queryService.reviewDocument(body.documentId, user.id);
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

  @Post('research-gaps')
  @ApiOperation({ summary: 'Cross-paper research gap analysis with cited evidence' })
  researchGaps(@Body() body: ResearchGapsDto, @CurrentUser() user: any) {
    return this.queryService.researchGaps({ ...body, userId: user.id });
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
  status(@Param('documentId') documentId: string, @CurrentUser() user: any) {
    return this.queryService.pipelineStatus(documentId, user.id);
  }
}

/** Accept only short opaque ids (UUID-like) so they are safe to store and match. */
function cleanRequestId(value?: string) {
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : undefined;
}
