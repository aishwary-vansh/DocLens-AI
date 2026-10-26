// src/auth/update-profile.spec.ts
// Password changes from Settings: accounts with a password must confirm it;
// accounts created with Google (hasPassword=false) can set a first password.

import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

async function makeService(user: any) {
  const users = {
    findByIdOrThrow: jest.fn().mockResolvedValue(user),
    update: jest.fn().mockImplementation((_id, changes) => Promise.resolve({ ...user, ...changes })),
    toProfile: jest.fn().mockImplementation(({ passwordHash, ...profile }) => profile),
  };
  const service = new AuthService(users as any, {} as any, {} as any);
  return { service, users };
}

describe('AuthService.updateProfile', () => {
  it('requires the current password when the account has one', async () => {
    const { service, users } = await makeService({ id: 'u1', hasPassword: true, passwordHash: await bcrypt.hash('old-pass', 4) });
    await expect(service.updateProfile('u1', { password: 'new-pass' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('rejects a wrong current password', async () => {
    const { service, users } = await makeService({ id: 'u1', hasPassword: true, passwordHash: await bcrypt.hash('old-pass', 4) });
    await expect(
      service.updateProfile('u1', { password: 'new-pass', currentPassword: 'nope' } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('changes the password with the right current password', async () => {
    const { service, users } = await makeService({ id: 'u1', hasPassword: true, passwordHash: await bcrypt.hash('old-pass', 4) });
    await service.updateProfile('u1', { password: 'new-pass', currentPassword: 'old-pass' } as any);
    const changes = users.update.mock.calls[0][1];
    expect(await bcrypt.compare('new-pass', changes.passwordHash)).toBe(true);
    expect(changes.hasPassword).toBe(true);
  });

  it('lets a Google-created account set its first password without a current one', async () => {
    const { service, users } = await makeService({ id: 'g1', hasPassword: false, passwordHash: await bcrypt.hash('random-unknown', 4) });
    const profile = await service.updateProfile('g1', { password: 'first-pass' } as any);
    const changes = users.update.mock.calls[0][1];
    expect(await bcrypt.compare('first-pass', changes.passwordHash)).toBe(true);
    expect(changes.hasPassword).toBe(true);
    expect(profile).not.toHaveProperty('passwordHash');
  });

  it('updates only the name when no password is given', async () => {
    const { service, users } = await makeService({ id: 'u1', hasPassword: true, passwordHash: 'x' });
    await service.updateProfile('u1', { name: '  New Name ' } as any);
    expect(users.update).toHaveBeenCalledWith('u1', { name: 'New Name' });
  });
});
