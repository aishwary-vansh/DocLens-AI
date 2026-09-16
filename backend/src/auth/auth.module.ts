// src/auth/auth.module.ts
import { Module, Logger } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';

// Sentinel defaults — if the runtime secret equals any of these, JWT signing is
// using an insecure default and we must warn loudly (but never log the actual value).
const WEAK_SECRETS = new Set([
  'change-me',
  'change-me-in-production',
  'change-this-jwt-secret',
  'secret',
  '',
]);

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => {
        const secret     = config.get<string>('jwt.secret') ?? 'change-me';
        const expiresIn  = config.get<string>('jwt.expiresIn') ?? '7d';
        const logger     = new Logger('AuthModule');

        // Warn on weak secret — NEVER log the secret value itself
        if (WEAK_SECRETS.has(secret) || secret.length < 32) {
          logger.warn(
            '⚠️  JWT_SECRET is a weak/default value. ' +
            'Set JWT_SECRET to a strong random string (≥32 chars) in your production environment.',
          );
        } else {
          logger.log(`✅ JWT configured — expiresIn=${expiresIn}, secret length=${secret.length} chars`);
        }

        return {
          secret,
          signOptions: {
            expiresIn: expiresIn as JwtModuleOptions['signOptions']['expiresIn'],
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, LocalStrategy, JwtStrategy],
  exports: [AuthService, JwtModule, UsersModule],
})
export class AuthModule {}
