// src/auth/guards/jwt-auth.guard.ts
import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger('JwtAuthGuard');

  /**
   * handleRequest is called after passport-jwt validates the token.
   * We log the failure reason (error name/message) without ever logging
   * the token value, password, or any other secret.
   */
  handleRequest(err: any, user: any, info: any, _context: ExecutionContext) {
    if (err || !user) {
      const reason = info?.name ?? info?.message ?? 'Unknown auth error';
      const message = this.friendlyMessage(info);
      // Log: rejection reason only — NO token, NO password, NO secret
      this.logger.warn(`JWT auth rejected — reason: ${reason}`);
      throw err ?? new UnauthorizedException(message);
    }
    return user;
  }

  private friendlyMessage(info: any): string {
    if (!info) return 'Unauthorised';
    switch (info.name) {
      case 'TokenExpiredError':
        return 'Token has expired — please log in again';
      case 'JsonWebTokenError':
        return 'Invalid token — please log in again';
      case 'NotBeforeError':
        return 'Token not yet valid';
      default:
        return info.message ?? 'Unauthorised';
    }
  }
}
