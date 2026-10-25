// src/auth/google-oauth.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side Google OAuth 2.0 authorization-code flow (with PKCE), used by the
// custom "Continue with Google" button:
//   GET  /auth/google/start     → 302 to Google; state + PKCE verifier in an
//                                 HttpOnly cookie scoped to /api/v1/auth/google
//   GET  /auth/google/callback  → checks state, exchanges the code (client
//                                 secret, server side), verifies the returned
//                                 ID token with GoogleTokenVerifier, then
//                                 302s to FRONTEND_URL/#/login?google_code=…
//   POST /auth/google/exchange  → the frontend trades that one-time code for
//                                 the DocLens JWT (never put in a URL).
// One-time codes live in memory for 60 s: fine for a single backend instance.
// ─────────────────────────────────────────────────────────────────────────────
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const OAUTH_COOKIE = 'dl_google_oauth';
export const OAUTH_COOKIE_PATH = '/api/v1/auth/google';
const COOKIE_MAX_AGE_S = 600;
const HANDOFF_TTL_MS = 60_000;

/** Reason codes the frontend maps to messages (#/login?google_error=…). */
export type GoogleOAuthError =
  | 'cancelled' | 'state' | 'exchange' | 'invalid' | 'unverified' | 'conflict' | 'unconfigured' | 'unavailable';

export class GoogleOAuthFailure extends Error {
  constructor(readonly reason: GoogleOAuthError, message: string) {
    super(message);
  }
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);
  private readonly handoffs = new Map<string, { result: unknown; expiresAt: number }>();

  constructor(private readonly config: ConfigService) {}

  private get clientId() { return this.config.get<string>('GOOGLE_CLIENT_ID') ?? ''; }
  private get clientSecret() { return this.config.get<string>('GOOGLE_CLIENT_SECRET') ?? ''; }
  get callbackUrl() { return this.config.get<string>('GOOGLE_CALLBACK_URL') ?? ''; }

  /** Where the browser lands after the callback (no trailing slash). */
  get frontendUrl(): string {
    return (this.config.get<string>('FRONTEND_URL') ?? '').replace(/\/+$/, '');
  }

  /** The redirect flow needs the client id, the secret and a callback URL. */
  get enabled(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.callbackUrl);
  }

  /** Cookies only travel over HTTPS when the callback itself is HTTPS. */
  get secureCookie(): boolean {
    return this.callbackUrl.startsWith('https://');
  }

  /** Build Google's consent URL plus the cookie value that proves the round trip. */
  start(): { url: string; cookie: string } {
    const state = base64url(randomBytes(24));
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return { url: `${AUTH_URL}?${params}`, cookie: `${state}.${verifier}` };
  }

  /** Validate the callback and return the Google ID token from the code exchange. */
  async callback(query: { code?: string; state?: string; error?: string }, cookie: string | undefined): Promise<string> {
    if (query.error) {
      // access_denied = the user closed or cancelled the consent screen.
      throw new GoogleOAuthFailure(query.error === 'access_denied' ? 'cancelled' : 'exchange', `Google returned ${query.error}`);
    }
    const [state, verifier] = String(cookie ?? '').split('.');
    if (!state || !verifier || !query.state || !sameString(state, query.state)) {
      throw new GoogleOAuthFailure('state', 'OAuth state missing or mismatched');
    }
    if (!query.code) throw new GoogleOAuthFailure('exchange', 'No authorization code');
    return this.exchangeCode(query.code, verifier);
  }

  /** Exposed for tests: the only network call of the redirect flow. */
  protected async postToken(body: URLSearchParams): Promise<{ ok: boolean; status: number; json: any }> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
  }

  private async exchangeCode(code: string, verifier: string): Promise<string> {
    let res: { ok: boolean; status: number; json: any };
    try {
      res = await this.postToken(new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.callbackUrl,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }));
    } catch (err) {
      throw new GoogleOAuthFailure('unavailable', `Token endpoint unreachable: ${(err as Error).message}`);
    }
    if (!res.ok || typeof res.json?.id_token !== 'string') {
      // Google's error code only (e.g. invalid_grant, redirect_uri_mismatch); never the secret.
      this.logger.warn(`Google code exchange failed: ${res.status} ${res.json?.error ?? ''}`);
      throw new GoogleOAuthFailure('exchange', `Code exchange failed (${res.status})`);
    }
    return res.json.id_token;
  }

  /** Store a sign-in result under a single-use, short-lived code. */
  issueHandoff(result: unknown): string {
    this.sweep();
    const code = base64url(randomBytes(32));
    this.handoffs.set(code, { result, expiresAt: Date.now() + HANDOFF_TTL_MS });
    return code;
  }

  /** Redeem a handoff code exactly once. */
  redeemHandoff(code: string): unknown {
    const entry = this.handoffs.get(code);
    this.handoffs.delete(code);
    if (!entry || entry.expiresAt < Date.now()) {
      throw new UnauthorizedException('Google sign-in link expired. Please try again.');
    }
    return entry.result;
  }

  private sweep() {
    const now = Date.now();
    for (const [code, entry] of this.handoffs) if (entry.expiresAt < now) this.handoffs.delete(code);
  }

  /** Frontend URL for the result of the callback. */
  landingUrl(param: { google_code: string } | { google_error: GoogleOAuthError }): string {
    return `${this.frontendUrl}/#/login?${new URLSearchParams(param)}`;
  }
}
