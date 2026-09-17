// src/app.module.ts
import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { createKeyv } from '@keyv/redis';
import { appConfig } from './config/app.config';
import { AuthModule } from './auth/auth.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { CollectionsModule } from './collections/collections.module';
import { DocumentsModule } from './documents/documents.module';
import { GatewayModule } from './gateway/gateway.module';
import { PrismaModule } from './prisma/prisma.module';
import { AppController } from './app.controller';

// ── AI Intelligence Layer ───────────────────────────────────────────────────
import { AiProxyModule } from './ai-proxy/ai-proxy.module';
import { QueryModule } from './query/query.module';


@Module({
  imports: [
    // ── Config — globally available via ConfigService ──────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: '.env',
    }),

    // ── Cache Module ────────────────────────────────────────────────────────
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService): any => {
        const redisUrl = config.get<string>('REDIS_URL') ?? process.env.REDIS_URL;
        const ttl = Number(process.env.CACHE_TTL_MS ?? 60000);

        if (!redisUrl) {
          return { ttl };
        }

        return {
          ttl,
          stores: [
            createKeyv(redisUrl, {
              namespace: process.env.CACHE_NAMESPACE ?? 'doclens',
              throwOnConnectError: false,
              throwOnErrors: false,
            }),
          ],
        };
      },
    }),

    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.RATE_LIMIT_TTL_MS ?? 60000),
        limit: Number(process.env.RATE_LIMIT_MAX ?? 120),
      },
    ]),

    // ── Core feature modules ───────────────────────────────────────────
    PrismaModule,
    AuthModule,        // AuthModule already imports UsersModule internally
    GatewayModule,
    WorkspacesModule,
    CollectionsModule,
    DocumentsModule,

    // ── AI Intelligence Layer ──────────────────────────────────────────
    AiProxyModule,
    QueryModule,

  ],
  controllers: [AppController],
  providers: [
    // Removed ThrottlerGuard to prevent 429 errors during local dev
  ],
})
export class AppModule {}
