// src/auth/google-token.verifier.ts
// ─────────────────────────────────────────────────────────────────────────────
// Verifies a Google Identity Services ID token (the `credential` the "Sign in
// with Google" button returns) without extra dependencies:
//   1. RS256 signature against Google's published JWKS (cached per Cache-Control)
//   2. iss = accounts.google.com, aud = GOOGLE_CLIENT_ID, exp/iat in range
//   3. email_verified = true
// The browser never sends a password; the backend issues its own DocLens JWT.
// ─────────────────────────────────────────────────────────────────────────────
import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicKey, verify, type JsonWebKeyInput } from 'crypto';

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CLOCK_SKEW_S = 60;

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

type Jwk = JsonWebKeyInput['key'] & { kid: string };

function decodeSegment<T>(segment: string): T {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
}

@Injectable()
export class GoogleTokenVerifier {
  private keys: Map<string, Jwk> = new Map();
  private keysExpireAt = 0;

  constructor(private readonly config: ConfigService) {}

  get clientId(): string {
    return this.config.get<string>('GOOGLE_CLIENT_ID') ?? '';
  }

  /** Exposed for tests: fetch is the only network call. */
  protected async fetchJwks(): Promise<{ keys: Jwk[]; maxAgeS: number }> {
    const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1];
    const body = (await res.json()) as { keys: Jwk[] };
    return { keys: body.keys ?? [], maxAgeS: Number(maxAge ?? 3600) };
  }

  private async keyFor(kid: string): Promise<Jwk | undefined> {
    if (!this.keys.has(kid) || Date.now() > this.keysExpireAt) {
      try {
        const { keys, maxAgeS } = await this.fetchJwks();
        this.keys = new Map(keys.map((k) => [k.kid, k]));
        this.keysExpireAt = Date.now() + maxAgeS * 1000;
      } catch {
        throw new ServiceUnavailableException('Could not reach Google to verify the sign-in. Please try again.');
      }
    }
    return this.keys.get(kid);
  }

  async verify(credential: string): Promise<GoogleIdentity> {
    if (!this.clientId) {
      throw new ServiceUnavailableException('Google sign-in is not configured on this server.');
    }
    const parts = String(credential ?? '').split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Invalid Google credential.');

    let header: { alg?: string; kid?: string };
    let payload: Record<string, any>;
    try {
      header = decodeSegment(parts[0]);
      payload = decodeSegment(parts[1]);
    } catch {
      throw new UnauthorizedException('Invalid Google credential.');
    }
    if (header.alg !== 'RS256' || !header.kid) throw new UnauthorizedException('Invalid Google credential.');

    const jwk = await this.keyFor(header.kid);
    if (!jwk) throw new UnauthorizedException('Invalid Google credential.');
    const signed = verify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey({ key: jwk, format: 'jwk' }),
      Buffer.from(parts[2], 'base64url'),
    );
    if (!signed) throw new UnauthorizedException('Invalid Google credential.');

    const now = Math.floor(Date.now() / 1000);
    if (!ISSUERS.has(payload.iss)) throw new UnauthorizedException('Invalid Google credential issuer.');
    if (payload.aud !== this.clientId) throw new UnauthorizedException('Google credential was issued for another app.');
    if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_S < now) {
      throw new UnauthorizedException('Google sign-in expired. Please try again.');
    }
    if (typeof payload.iat === 'number' && payload.iat - CLOCK_SKEW_S > now) {
      throw new UnauthorizedException('Invalid Google credential.');
    }
    if (!payload.email || payload.email_verified !== true) {
      throw new UnauthorizedException('Your Google email address is not verified.');
    }

    return {
      sub: String(payload.sub),
      email: String(payload.email).toLowerCase(),
      name: String(payload.name || payload.given_name || payload.email.split('@')[0]).slice(0, 60),
      picture: payload.picture,
    };
  }
}
