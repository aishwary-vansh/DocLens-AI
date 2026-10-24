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
} from '@nestjs/common';
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
import { GoogleLoginDto } from './dto/google-login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from '../users/users.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
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

  // ─── GET /auth/config ─────────────────────────────────────────────────
  @Get('config')
  @ApiOperation({ summary: 'Public sign-in options (Google client id, if configured)' })
  config() {
    // The Google client id is public by design (it is embedded in every sign-in page).
    return { googleClientId: this.authService.googleClientId || null };
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
