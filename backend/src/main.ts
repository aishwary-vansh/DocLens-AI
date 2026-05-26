// src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { UsersService } from './users/users.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error', 'debug', 'verbose'],
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('port') ?? 3001;
  const corsOrigins = config.get<string[]>('cors.origins') ?? ['http://localhost:5173'];
  const isDev = config.get<string>('nodeEnv') !== 'production';

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // ── Static uploads directory ─────────────────────────────────────────────
  // Uploaded PDFs are accessible at: GET /uploads/<userId>/<filename>
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  // ── Global prefix ────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ── CORS ─────────────────────────────────────────────────────────────────
  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // ── Global validation pipe ───────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Global filters & interceptors ────────────────────────────────────────
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  // ── Swagger (always enabled so routes are verifiable on Render) ─────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('DocLens API')
    .setDescription(
      'REST API for DocLens — Knowledge Graph-Driven Research Intelligence Platform.\n\n' +
      '**Auth flow:** `POST /auth/login` → copy `accessToken` → click 🔒 Authorize → paste `Bearer <token>`',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Auth', 'Register, login, profile')
    .addTag('Workspaces', 'Workspace CRUD')
    .addTag('Collections', 'Collection CRUD within workspaces')
    .addTag('Documents', 'PDF upload and document management')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  Logger.log(`📖 Swagger docs → http://localhost:${port}/api/docs`, 'Bootstrap');

  // ── Seed users ───────────────────────────────────────────────────────────
  const usersService = app.get(UsersService);
  const adminEmail    = config.get<string>('ADMIN_EMAIL')    ?? 'admin@doclens.ai';
  const adminPassword = config.get<string>('ADMIN_PASSWORD') ?? 'Admin@1234';
  await usersService.seed(adminEmail, adminPassword, 'Admin', 'admin');
  await usersService.seed('demo@doclens.ai', 'Demo@1234', 'Demo User', 'viewer');
  Logger.log(`🌱 Seed users ready  →  ${adminEmail} / ${adminPassword}`, 'Bootstrap');

  // ── Listen ───────────────────────────────────────────────────────────────
  await app.listen(port);
  Logger.log(`🚀 DocLens API      →  http://localhost:${port}/api/v1`, 'Bootstrap');
}

bootstrap();
