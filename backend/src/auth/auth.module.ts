// src/auth/auth.module.ts
import { Logger, Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    // ConfigModule is NOT imported here — it is already isGlobal:true in AppModule.
    // Adding it here caused a double-init scoping issue that silently prevented
    // AuthModule from completing DI resolution in production.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => {
        const expiresIn = config.get<string>('jwt.expiresIn') ?? '7d';
        const secret = config.get<string>('jwt.secret') ?? 'change-me-in-production';
        Logger.log(`JwtModule configured — expiresIn=${expiresIn}`, 'AuthModule');
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
  exports: [AuthService, JwtModule],
})
export class AuthModule {
  constructor() {
    Logger.log('✅ AuthModule instantiated', 'AuthModule');
  }
}
