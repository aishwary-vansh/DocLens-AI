// src/auth/auth.service.ts
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { GoogleTokenVerifier } from './google-token.verifier';
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
   * Sign in with a Google ID token. The Google account is matched by its
   * verified email: an existing DocLens account with that email is signed in,
   * otherwise a new viewer account is created with an unusable random password
   * (the user signs in with Google; no password is ever known).
   */
  async googleLogin(credential: string) {
    const identity = await this.google.verify(credential);
    let user = await this.usersService.findByEmail(identity.email);
    if (!user) {
      user = await this.usersService.create(identity.email, randomBytes(32).toString('hex'), identity.name);
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
