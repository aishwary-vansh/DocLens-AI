import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { User } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';

export type UserRole = 'admin' | 'viewer';

export type SafeUser = Omit<User, 'passwordHash'>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async seed(email: string, password: string, name: string, role: UserRole = 'viewer') {
    const existing = await this.findByEmail(email);
    if (existing) return existing;

    const passwordHash = await bcrypt.hash(password, 10);
    return this.prisma.user.create({
      data: { email, name, passwordHash, role },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByIdOrThrow(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async create(email: string, password: string, name: string): Promise<User> {
    const existing = await this.findByEmail(email);
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(password, 10);
    return this.prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: 'viewer',
      },
    });
  }

  toProfile(user: User): SafeUser {
    const { passwordHash, ...profile } = user;
    return profile;
  }
}
