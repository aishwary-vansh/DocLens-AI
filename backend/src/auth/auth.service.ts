// src/auth/auth.service.ts
import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { GoogleIdentity, GoogleTokenVerifier } from './google-token.verifier';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly google: GoogleTokenVerifier,
  ) {}

  /**
   * Called by LocalStrategy — verifies email + password.
   * Returns stripped user (no hash) or null on mismatch.
   */
  async validateUser(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) return null;

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return null;

    return this.usersService.toProfile(user);
  }

  get googleClientId(): string {
    return this.google.clientId;
  }

  /** Issue a JWT after successful LocalStrategy validation */
  async login(user: any) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return {
      accessToken: this.jwtService.sign(payload),
      user,
    };
  }

  /** Register a new viewer account then immediately issue a token */
  async register(dto: RegisterDto) {
    const user = await this.usersService.create(dto.email, dto.password, dto.name);
    const profile = this.usersService.toProfile(user);
    return this.login(profile);
  }

  /**
   * Sign in with a Google ID token (from the Google button popup, or from the
   * redirect flow's code exchange).
   */
  async googleLogin(credential: string) {
    return this.signInGoogleIdentity(await this.google.verify(credential));
  }

  /**
   * Match a verified Google identity to a DocLens account:
   *   1. an account already linked to this Google `sub` is signed in;
   *   2. otherwise an account with the same verified email is linked to it
   *      (its email/password login keeps working) and signed in;
   *   3. otherwise a new viewer account is created with an unusable random
   *      password (the user signs in with Google; no password is ever known).
   * An email account already linked to a *different* Google account is refused.
   */
  async signInGoogleIdentity(identity: GoogleIdentity) {
    let user = await this.usersService.findByGoogleId(identity.sub);
    if (!user) {
      const byEmail = await this.usersService.findByEmail(identity.email);
      if (byEmail?.googleId && byEmail.googleId !== identity.sub) {
        throw new ConflictException('This email is already linked to a different Google account.');
      }
      user = byEmail
        ? await this.usersService.update(byEmail.id, { googleId: identity.sub })
        : await this.usersService.create(identity.email, randomBytes(32).toString('hex'), identity.name, identity.sub);
    }
    return this.login(this.usersService.toProfile(user));
  }

  /** PATCH /auth/me: change display name and/or password (current password required). */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.usersService.findByIdOrThrow(userId);
    const changes: { name?: string; passwordHash?: string } = {};
    if (dto.name !== undefined) changes.name = dto.name.trim();
    if (dto.password) {
      if (!dto.currentPassword) throw new BadRequestException('Enter your current password to set a new one.');
      if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
        throw new UnauthorizedException('Current password is incorrect.');
      }
      changes.passwordHash = await bcrypt.hash(dto.password, 10);
    }
    if (!Object.keys(changes).length) return this.usersService.toProfile(user);
    return this.usersService.toProfile(await this.usersService.update(userId, changes));
  }
}
