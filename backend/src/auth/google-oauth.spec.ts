// src/auth/google-oauth.spec.ts
// Redirect (authorization-code + PKCE) Google flow: state check, cancellation,
// code exchange, one-time handoff codes, and the controller's redirects.
// Google's token endpoint is stubbed; nothing leaves the process.
import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { AuthController } from './auth.controller';
import { GoogleOAuthFailure, GoogleOAuthService, OAUTH_COOKIE } from './google-oauth.service';

const ENV: Record<string, string> = {
  GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-secret',
  GOOGLE_CALLBACK_URL: 'https://app.example/api/v1/auth/google/callback',
  FRONTEND_URL: 'https://app.example/',
};

class StubOAuth extends GoogleOAuthService {
  posted: URLSearchParams[] = [];
  reply: { ok: boolean; status: number; json: any } = { ok: true, status: 200, json: { id_token: 'google.id.token' } };
  protected async postToken(body: URLSearchParams) {
    this.posted.push(body);
    return this.reply;
  }
}

function makeOAuth(env: Record<string, string> = ENV) {
  return new StubOAuth({ get: (key: string) => env[key] } as any);
}

function fakeRes() {
  const res: any = { cookies: {} as Record<string, any>, cleared: [] as string[] };
  res.cookie = (name: string, value: string, opts: any) => { res.cookies[name] = { value, opts }; };
  res.clearCookie = (name: string) => res.cleared.push(name);
  res.redirect = (status: number, url: string) => { res.status = status; res.location = url; };
  return res;
}

describe('GoogleOAuthService', () => {
  it('builds a consent URL with state and an S256 PKCE challenge', () => {
    const oauth = makeOAuth();
    const { url, cookie } = oauth.start();
    const params = new URL(url).searchParams;
    const [state, verifier] = cookie.split('.');
    expect(params.get('client_id')).toBe(ENV.GOOGLE_CLIENT_ID);
    expect(params.get('redirect_uri')).toBe(ENV.GOOGLE_CALLBACK_URL);
    expect(params.get('scope')).toBe('openid email profile');
    expect(params.get('state')).toBe(state);
    expect(params.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(url).not.toContain('test-secret');
  });

  it('exchanges the code with the secret and PKCE verifier', async () => {
    const oauth = makeOAuth();
    const { cookie } = oauth.start();
    const state = cookie.split('.')[0];
    await expect(oauth.callback({ code: 'abc', state }, cookie)).resolves.toBe('google.id.token');
    expect(oauth.posted[0].get('client_secret')).toBe('test-secret');
    expect(oauth.posted[0].get('code_verifier')).toBe(cookie.split('.')[1]);
  });

  it.each([
    ['cancelled', { error: 'access_denied' }, 'cookie.value'],
    ['state', { code: 'abc', state: 'other' }, 'mine.verifier'],
    ['state', { code: 'abc', state: 'mine' }, undefined],
  ])('fails with %s', async (reason, query, cookie) => {
    const oauth = makeOAuth();
    await expect(oauth.callback(query, cookie)).rejects.toMatchObject({ reason });
    expect(oauth.posted).toHaveLength(0);
  });

  it('reports a rejected code exchange', async () => {
    const oauth = makeOAuth();
    oauth.reply = { ok: false, status: 400, json: { error: 'invalid_grant' } };
    await expect(oauth.callback({ code: 'abc', state: 's' }, 's.v')).rejects.toBeInstanceOf(GoogleOAuthFailure);
  });

  it('redeems a handoff code exactly once', () => {
    const oauth = makeOAuth();
    const code = oauth.issueHandoff({ accessToken: 'jwt' });
    expect(oauth.redeemHandoff(code)).toEqual({ accessToken: 'jwt' });
    expect(() => oauth.redeemHandoff(code)).toThrow(UnauthorizedException);
  });

  it('is disabled without the secret or callback URL', () => {
    expect(makeOAuth({ GOOGLE_CLIENT_ID: 'id' }).enabled).toBe(false);
    expect(makeOAuth().enabled).toBe(true);
  });
});

describe('AuthController Google redirect routes', () => {
  function controller(oauth: StubOAuth, googleLogin: jest.Mock = jest.fn(async () => ({ accessToken: 'jwt', user: { id: 'u1' } }))) {
    const auth: any = { googleLogin, googleClientId: ENV.GOOGLE_CLIENT_ID };
    return { ctrl: new AuthController(auth, {} as any, oauth), googleLogin };
  }

  it('sets an HttpOnly, path-scoped state cookie and redirects to Google', () => {
    const oauth = makeOAuth();
    const res = fakeRes();
    controller(oauth).ctrl.googleStart(res);
    expect(res.location).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(res.cookies[OAUTH_COOKIE].opts).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true, path: '/api/v1/auth/google' });
  });

  it('hands a one-time code (never the JWT) to the frontend', async () => {
    const oauth = makeOAuth();
    const { ctrl, googleLogin } = controller(oauth);
    const res = fakeRes();
    await ctrl.googleCallback({ headers: { cookie: `${OAUTH_COOKIE}=s.v` } } as any, res, { code: 'abc', state: 's' });
    expect(googleLogin).toHaveBeenCalledWith('google.id.token');
    expect(res.location).toMatch(/^https:\/\/app\.example\/#\/login\?google_code=/);
    expect(res.location).not.toContain('jwt');
    expect(res.cleared).toContain(OAUTH_COOKIE);
    const code = new URLSearchParams(res.location.split('?')[1]).get('google_code')!;
    expect(ctrl.googleExchange({ code })).toEqual({ accessToken: 'jwt', user: { id: 'u1' } });
  });

  it('redirects with a reason when the user cancels or the token is invalid', async () => {
    const oauth = makeOAuth();
    const res = fakeRes();
    await controller(oauth).ctrl.googleCallback({ headers: {} } as any, res, { error: 'access_denied' });
    expect(res.location).toBe('https://app.example/#/login?google_error=cancelled');

    const rejected = fakeRes();
    const failing = jest.fn(async () => { throw new UnauthorizedException('Invalid Google credential.'); });
    await controller(oauth, failing).ctrl.googleCallback(
      { headers: { cookie: `${OAUTH_COOKIE}=s.v` } } as any, rejected, { code: 'abc', state: 's' });
    expect(rejected.location).toBe('https://app.example/#/login?google_error=invalid');
  });

  it('reports unconfigured instead of redirecting to Google', () => {
    const res = fakeRes();
    controller(makeOAuth({ GOOGLE_CLIENT_ID: 'id' })).ctrl.googleStart(res);
    expect(res.location).toBe('/#/login?google_error=unconfigured');
  });
});
