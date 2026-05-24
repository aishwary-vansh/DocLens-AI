import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  Body,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join, basename } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { Response } from 'express';
import {
  ApiTags, ApiBearerAuth, ApiOperation,
  ApiOkResponse, ApiCreatedResponse, ApiNotFoundResponse,
  ApiConsumes, ApiBody, ApiQuery,
} from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  // ─── POST /documents/upload ──────────────────────────────────
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload a PDF document to a collection' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        collectionId: { type: 'string' },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Document metadata record created' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const userId = (req as any).user?.id ?? 'unknown';
          const uploadPath = join(process.cwd(), 'uploads', userId);
          if (!existsSync(uploadPath)) mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
          cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        const isPdf =
          file.mimetype === 'application/pdf' &&
          extname(file.originalname).toLowerCase() === '.pdf';
        cb(isPdf ? null : new Error('Only PDF files are allowed'), isPdf);
      },
      limits: { fileSize: 50 * 1024 * 1024, files: 1 },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('collectionId') collectionId: string,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.create(file, collectionId, user.id);
  }

  // ─── GET /documents?collectionId=xxx ─────────────────────────
  @Get()
  @ApiOperation({ summary: 'List all documents in a collection' })
  @ApiQuery({ name: 'collectionId', required: true })
  findAll(@Query('collectionId') collectionId: string, @CurrentUser() user: any) {
    return this.documentsService.findByCollection(collectionId, user.id);
  }

  // ─── GET /documents/:id ──────────────────────────────────────
  @Get('workspace/overview')
  @ApiOperation({ summary: 'Get research workspace overview data' })
  workspaceOverview(@CurrentUser() user: any) {
    return this.documentsService.workspaceOverview(user.id);
  }

  @Get(':id/progress')
  @ApiOperation({ summary: 'Get reading progress for a paper' })
  getProgress(@Param('id') id: string, @CurrentUser() user: any) {
    return this.documentsService.getReadingProgress(id, user.id);
  }

  @Patch(':id/progress')
  @ApiOperation({ summary: 'Update reading progress for a paper' })
  updateProgress(
    @Param('id') id: string,
    @Body() body: { status?: string; progress?: number; lastReadPage?: number; notes?: string },
    @CurrentUser() user: any,
  ) {
    return this.documentsService.updateReadingProgress(id, user.id, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get document metadata' })
  @ApiOkResponse({ description: 'Document object with status' })
  @ApiNotFoundResponse()
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.documentsService.findOne(id, user.id);
  }

  // ─── GET /documents/:id/download ────────────────────────────
  @Get(':id/download')
  @ApiOperation({ summary: 'Download original PDF file' })
  @ApiOkResponse({ description: 'PDF file stream' })
  async download(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const filePath = await this.documentsService.getFilePath(id, user.id);
    const doc      = await this.documentsService.findOne(id, user.id);
    res.setHeader('Content-Disposition', `attachment; filename="${doc.filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.sendFile(filePath);
  }

  // ─── DELETE /documents/:id ───────────────────────────────────
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a document' })
  @ApiOkResponse({ description: '{ id } of deleted document' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.documentsService.remove(id, user.id);
  }
}
