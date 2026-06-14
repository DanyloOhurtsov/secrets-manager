import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../crypto/crypto.service';

@Injectable()
export class SecretsService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
  ) {}

  async create(environmentId: string, key: string, value: string) {
    const enc = this.crypto.encrypt(value);

    const data: Prisma.SecretUncheckedCreateInput = {
      key,
      environmentId,
      ciphertext: enc.ciphertext,
      valueIv: enc.valueIv,
      valueAuthTag: enc.valueAuthTag,
      encryptedDataKey: enc.encryptedDataKey,
      dataKeyIv: enc.dataKeyIv,
      dataKeyAuthTag: enc.dataKeyAuthTag,
      keyVersion: enc.keyVersion,
    };

    return this.prisma.secret.create({
      data,
      select: { id: true, key: true, environmentId: true, createdAt: true },
    });
  }

  async findByEnvironment(environmentId: string) {
    const secrets = await this.prisma.secret.findMany({
      where: { environmentId },
    });

    return secrets.map((s) => ({
      id: s.id,
      key: s.key,
      value: this.crypto.decrypt({
        ciphertext: s.ciphertext,
        valueIv: s.valueIv,
        valueAuthTag: s.valueAuthTag,
        encryptedDataKey: s.encryptedDataKey,
        dataKeyIv: s.dataKeyIv,
        dataKeyAuthTag: s.dataKeyAuthTag,
        keyVersion: s.keyVersion,
      }),
      createdAt: s.createdAt,
    }));
  }

  async remove(id: string) {
    const secret = await this.prisma.secret.findUnique({ where: { id } });
    if (!secret) throw new NotFoundException('Secret not found');
    return this.prisma.secret.delete({ where: { id } });
  }
}
