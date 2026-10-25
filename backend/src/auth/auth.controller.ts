// src/auth/auth.controller.ts
import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  HttpCode,
  HttpStatus,
  Request,
  Patch,
  Query,
  Req,
  Res,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request as ExpressRequest, Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleExchangeDto, GoogleLoginDto } from './dto/google-login.dto';
import {
  GoogleOAuthError,
  GoogleOAuthFailure,
  GoogleOAuthService,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
} from './google-oauth.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from '../users/users.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly googleOAuth: GoogleOAuthService,
  ) {}

  // ─── POST /auth/register ──────────────────────────────────────────────
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new viewer account' })
  @ApiCreatedResponse({ description: 'Returns JWT + user profile' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // ─── POST /auth/login ─────────────────────────────────────────────────
  @Post('login')
  @UseGuards(LocalAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email + password → JWT' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ description: 'Returns accessToken + user profile' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  async login(@Request() req: any) {
    // req.user is set by LocalStrategy → LocalAuthGuard
    return this.authService.login(req.user);
  }

  // ─── POST /auth/google ────────────────────────────────────────────────
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with a Google ID token → JWT' })
  @ApiOkResponse({ description: 'Returns accessToken + user profile' })
  @ApiUnauthorizedResponse({ description: 'Invalid, expired or foreign Google credential' })
  async google(@Body() dto: GoogleLoginDto) {
    return this.authService.googleLogin(dto.credential);
  }

  // ─── GET /auth/google/start ───────────────────────────────────────────
  @Get('google/start')
  @ApiOperation({ summary: 'Redirect to Google (authorization-code flow with PKCE)' })
  googleStart(@Res() res: Response) {
    if (!this.googleOAuth.enabled) {
      return res.redirect(302, this.googleOAuth.landingUrl({ google_error: 'unconfigured' }));
    }
    const { url, cookie } = this.googleOAuth.start();
    res.cookie(OAUTH_COOKIE, cookie, {
      httpOnly: true,
      sameSite: 'lax', // sent on Google's top-level redirect back to the callback
      secure: this.googleOAuth.secureCookie,
      path: OAUTH_COOKIE_PATH,
      maxAge: 600_000,
    });
    return res.redirect(302, url);
  }

  // ─── GET /auth/google/callback ────────────────────────────────────────
  @Get('google/callback')
  @ApiOperation({ summary: 'Google redirect target: verifies, then hands off to the frontend' })
  async googleCallback(
    @Req() req: ExpressRequest,
    @Res() res: Response,
    @Query() query: { code?: string; state?: string; error?: string },
  ) {
    const cookie = readCookie(req.headers.cookie, OAUTH_COOKIE);
    res.clearCookie(OAUTH_COOKIE, { path: OAUTH_COOKIE_PATH });
    try {
      const idToken = await this.googleOAuth.callback(query, cookie);
      const result = await this.authService.googleLogin(idToken);
      return res.redirect(302, this.googleOAuth.landingUrl({ google_code: this.googleOAuth.issueHandoff(result) }));
    } catch (err) {
      return res.redirect(302, this.googleOAuth.landingUrl({ google_error: googleErrorReason(err) }));
    }
  }

  // ─── POST /auth/google/exchange ───────────────────────────────────────
  @Post('google/exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trade the one-time code from the Google callback for a JWT' })
  @ApiOkResponse({ description: 'Returns accessToken + user profile' })
  googleExchange(@Body() dto: GoogleExchangeDto) {
    return this.googleOAuth.redeemHandoff(dto.code);
  }

  // ─── GET /auth/config ─────────────────────────────────────────────────
  @Get('config')
  @ApiOperation({ summary: 'Public sign-in options (Google client id, if configured)' })
  config() {
    // The Google client id is public by design (it is embedded in every sign-in page).
    // googleRedirect: the server-side code flow (client secret + callback URL) is set up.
    return {
      googleClientId: this.authService.googleClientId || null,
      googleRedirect: Boolean(this.authService.googleClientId) && this.googleOAuth.enabled,
    };
  }

  // ─── PATCH /auth/me ───────────────────────────────────────────────────
  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update display name and/or password' })
  async updateMe(@CurrentUser() user: any, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.id, dto);
  }

  // ─── GET /auth/me ─────────────────────────────────────────────────────
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get authenticated user profile' })
  @ApiOkResponse({ description: 'Current user profile (no passwordHash)' })
  async me(@CurrentUser() user: any) {
    return this.usersService.toProfile(user);
  }
}

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** Map a callback failure to the reason code the login page explains. */
function googleErrorReason(err: unknown): GoogleOAuthError {
  if (err instanceof GoogleOAuthFailure) return err.reason;
  if (err instanceof ConflictException) return 'conflict';
  if (err instanceof ServiceUnavailableException) return 'unavailable';
  if (/not verified/i.test((err as Error)?.message ?? '')) return 'unverified';
  return 'invalid';
}
