// src/auth/strategies/jwt.strategy.ts
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

export interface JwtPayload {
  sub: string;   // user id
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

// Sentinel values that indicate misconfiguration — never production secrets
const WEAK_SECRETS = new Set([
  'change-me',
  'change-me-in-production',
  'change-this-jwt-secret',
  'secret',
  '',
]);

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger('JwtStrategy');

  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    const secret = config.get<string>('jwt.secret') ?? 'change-me';

    // Warn loudly on startup if the JWT secret is a default/weak value.
    // We never log the secret value itself.
    if (WEAK_SECRETS.has(secret) || secret.length < 32) {
      new Logger('JwtStrategy').warn(
        '⚠️  JWT_SECRET is weak or default. Set a strong random secret ≥32 chars in production.',
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Called after passport-jwt successfully verifies the token signature and expiry.
   * Loads the live user record to ensure the account still exists.
   * Never logs the token payload — only the user id on failure.
   */
  async validate(payload: JwtPayload) {
    if (!payload?.sub) {
      this.logger.warn('JWT validate: payload missing sub claim');
      throw new UnauthorizedException('Invalid token payload');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      // Log the user-id (not secret) so ops can trace the issue
      this.logger.warn(`JWT validate: user not found — sub=${payload.sub}`);
      throw new UnauthorizedException('Token user not found');
    }

    return user; // attached to request.user
  }
}
