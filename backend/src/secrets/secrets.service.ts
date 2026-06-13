import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class SecretsService {
  constructor(private prisma: PrismaService) {}

  async create(environmentId: string, key: string, value: string) {
    // ЕТАП 2: тут замість простого кодування буде encrypt(value)
    const encryptedValue = new TextEncoder().encode(value);

    return this.prisma.secret.create({
      data: { key, encryptedValue, environmentId },
      // не повертаємо саме значення у відповіді create — лише метадані
      select: { id: true, key: true, environmentId: true, createdAt: true },
    });
  }

  async findByEnvironment(environmentId: string) {
    const secrets = await this.prisma.secret.findMany({
      where: { environmentId },
    });

    // ЕТАП 2: тут декодування заміниться на decrypt(...)
    return secrets.map((s) => ({
      id: s.id,
      key: s.key,
      value: new TextDecoder().decode(s.encryptedValue),
      createdAt: s.createdAt,
    }));
  }

  async remove(id: string) {
    const secret = await this.prisma.secret.findUnique({ where: { id } });
    if (!secret) throw new NotFoundException('Secret not found');
    return this.prisma.secret.delete({ where: { id } });
  }
}
