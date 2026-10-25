// src/auth/google-auth.spec.ts
// Google sign-in (ID-token verification against a local test key) and
// PATCH /auth/me profile updates, with an in-memory users service.
import { BadRequestException, ConflictException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { generateKeyPairSync, createSign } from 'crypto';
import { AuthService } from './auth.service';
import { GoogleTokenVerifier } from './google-token.verifier';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'k1', alg: 'RS256', use: 'sig' };

class TestVerifier extends GoogleTokenVerifier {
  fetches = 0;
  protected async fetchJwks() {
    this.fetches += 1;
    return { keys: [jwk as any], maxAgeS: 3600 };
  }
}

function idToken(overrides: Record<string, unknown> = {}, kid = 'k1') {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'g-123', email: 'Ada@Lab.edu',
    email_verified: true, name: 'Ada Lovelace', iat: now, exp: now + 3600, ...overrides,
  })).toString('base64url');
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

class FakeUsers {
  users: Record<string, any> = {};
  async findByEmail(email: string) { return Object.values(this.users).find((u) => u.email === email) ?? null; }
  async findByGoogleId(googleId: string) { return Object.values(this.users).find((u) => u.googleId === googleId) ?? null; }
  async findByIdOrThrow(id: string) { return this.users[id]; }
  async create(email: string, password: string, name: string, googleId?: string) {
    const user = { id: `u${Object.keys(this.users).length + 1}`, email, name, role: 'viewer', passwordHash: await bcrypt.hash(password, 4), googleId: googleId ?? null };
    this.users[user.id] = user;
    return user;
  }
  async update(id: string, data: any) { Object.assign(this.users[id], data); return this.users[id]; }
  toProfile(user: any) { const { passwordHash, googleId, ...rest } = user; return rest; }
}

function setup(clientId = CLIENT_ID) {
  const config = { get: (key: string) => (key === 'GOOGLE_CLIENT_ID' ? clientId : undefined) } as unknown as ConfigService;
  const verifier = new TestVerifier(config);
  const users = new FakeUsers();
  const jwt = new JwtService({ secret: 'test-secret-that-is-long-enough-for-testing-purposes-32+' });
  return { verifier, users, auth: new AuthService(users as any, jwt, verifier) };
}

describe('Google sign-in', () => {
  it('creates an account for a new verified Google user and returns a DocLens token', async () => {
    const { auth, users } = setup();
    const result = await auth.googleLogin(idToken());
    expect(result.accessToken).toBeTruthy();
    expect(result.user.email).toBe('ada@lab.edu');
    expect(result.user.name).toBe('Ada Lovelace');
    expect((result.user as any).passwordHash).toBeUndefined();
    expect(Object.keys(users.users)).toHaveLength(1);
  });

  it('signs in the existing account with the same verified email (no duplicate)', async () => {
    const { auth, users } = setup();
    await users.create('ada@lab.edu', 'password1', 'Existing Ada');
    const result = await auth.googleLogin(idToken());
    expect(result.user.id).toBe('u1');
    expect(Object.keys(users.users)).toHaveLength(1);
  });

  it('links the Google account on first sign-in and keeps the password login', async () => {
    const { auth, users } = setup();
    await users.create('ada@lab.edu', 'password1', 'Existing Ada');
    await auth.googleLogin(idToken());
    expect(users.users.u1.googleId).toBe('g-123');
    expect((await auth.googleLogin(idToken())).user).not.toHaveProperty('googleId');
    expect(await auth.validateUser('ada@lab.edu', 'password1')).toMatchObject({ id: 'u1' });
  });

  it('finds a linked account by Google id even after the Google email changes', async () => {
    const { auth, users } = setup();
    await auth.googleLogin(idToken());
    const result = await auth.googleLogin(idToken({ email: 'ada@new-lab.edu' }));
    expect(result.user.id).toBe('u1');
    expect(Object.keys(users.users)).toHaveLength(1);
  });

  it('refuses an email already linked to a different Google account', async () => {
    const { auth } = setup();
    await auth.googleLogin(idToken({ sub: 'g-first' }));
    await expect(auth.googleLogin(idToken({ sub: 'g-second' }))).rejects.toThrow(ConflictException);
  });

  it('gives Google-created accounts no usable password', async () => {
    const { auth } = setup();
    await auth.googleLogin(idToken());
    expect(await auth.validateUser('ada@lab.edu', '')).toBeNull();
  });

  it('caches Google keys between sign-ins', async () => {
    const { auth, verifier } = setup();
    await auth.googleLogin(idToken());
    await auth.googleLogin(idToken());
    expect(verifier.fetches).toBe(1);
  });

  it.each([
    ['another audience', { aud: 'someone-else' }],
    ['a foreign issuer', { iss: 'https://evil.example' }],
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ['an unverified email', { email_verified: false }],
  ])('rejects %s', async (_label, overrides) => {
    const { auth } = setup();
    await expect(auth.googleLogin(idToken(overrides))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a tampered payload and an unknown key id', async () => {
    const { auth } = setup();
    const [h, , sig] = idToken().split('.');
    const forged = Buffer.from(JSON.stringify({ iss: 'accounts.google.com', aud: CLIENT_ID, email: 'x@y.z', email_verified: true, exp: 9e9 })).toString('base64url');
    await expect(auth.googleLogin(`${h}.${forged}.${sig}`)).rejects.toThrow(UnauthorizedException);
    await expect(auth.googleLogin(idToken({}, 'unknown-kid'))).rejects.toThrow(UnauthorizedException);
    await expect(auth.googleLogin('not-a-jwt')).rejects.toThrow(UnauthorizedException);
  });

  it('reports a clear error when Google sign-in is not configured', async () => {
    const { auth } = setup('');
    await expect(auth.googleLogin(idToken())).rejects.toThrow(ServiceUnavailableException);
  });
});

describe('PATCH /auth/me', () => {
  it('updates the name without a password', async () => {
    const { auth, users } = setup();
    await users.create('a@b.c', 'oldpass1', 'Old');
    const profile = await auth.updateProfile('u1', { name: '  New Name ' });
    expect(profile.name).toBe('New Name');
  });

  it('changes the password only with the correct current password', async () => {
    const { auth, users } = setup();
    await users.create('a@b.c', 'oldpass1', 'Old');
    await expect(auth.updateProfile('u1', { password: 'newpass1' })).rejects.toThrow(BadRequestException);
    await expect(auth.updateProfile('u1', { password: 'newpass1', currentPassword: 'wrong' })).rejects.toThrow(UnauthorizedException);
    await auth.updateProfile('u1', { password: 'newpass1', currentPassword: 'oldpass1' });
    expect(await bcrypt.compare('newpass1', users.users.u1.passwordHash)).toBe(true);
  });
});
