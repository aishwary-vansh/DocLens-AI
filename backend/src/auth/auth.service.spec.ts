// src/auth/auth.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: UsersService;
  let jwtService: JwtService;
  let users: any[];

  beforeEach(async () => {
    users = [];
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        UsersService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(({ where }) => {
                if (where.email) return users.find((u) => u.email === where.email) ?? null;
                if (where.id) return users.find((u) => u.id === where.id) ?? null;
                return null;
              }),
              create: jest.fn(({ data }) => {
                const user = {
                  id: String(users.length + 1),
                  ...data,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                };
                users.push(user);
                return user;
              }),
            },
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(() => 'mock.jwt.token'),
          },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    usersService = module.get<UsersService>(UsersService);
    jwtService = module.get<JwtService>(JwtService);
  });

  describe('register()', () => {
    it('should register a new user and return a token', async () => {
      const result = await authService.register({
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
      });
      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.user.email).toBe('test@example.com');
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('should throw on duplicate email', async () => {
      await authService.register({
        email: 'dup@example.com',
        password: 'password123',
        name: 'User One',
      });
      await expect(
        authService.register({
          email: 'dup@example.com',
          password: 'password456',
          name: 'User Two',
        }),
      ).rejects.toThrow();
    });
  });

  describe('validateUser()', () => {
    it('should return user profile on valid credentials', async () => {
      await authService.register({
        email: 'valid@example.com',
        password: 'mypassword',
        name: 'Valid User',
      });
      const result = await authService.validateUser('valid@example.com', 'mypassword');
      expect(result).not.toBeNull();
      expect(result!.email).toBe('valid@example.com');
    });

    it('should return null on wrong password', async () => {
      await authService.register({
        email: 'another@example.com',
        password: 'correctpass',
        name: 'Another User',
      });
      const result = await authService.validateUser('another@example.com', 'wrongpass');
      expect(result).toBeNull();
    });

    it('should return null for non-existent email', async () => {
      const result = await authService.validateUser('nobody@example.com', 'pass');
      expect(result).toBeNull();
    });
  });

  describe('login()', () => {
    it('should return accessToken and user', async () => {
      const result = await authService.login({
        id: '1',
        email: 'admin@ledgerx.com',
        role: 'admin',
        name: 'Admin',
      });
      expect(result.accessToken).toBeDefined();
      expect(result.user.email).toBe('admin@ledgerx.com');
      expect(jwtService.sign).toHaveBeenCalled();
    });
  });
});
