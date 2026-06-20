import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { AuthorizationService, Role } from '../auth/authorization.service';

@Injectable()
export class SecretsService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private authz: AuthorizationService,
  ) {}

  /** Дістає оточення з його проєктом або кидає 404. */
  private async getEnvironmentOrThrow(environmentId: string) {
    const env = await this.prisma.environment.findUnique({
      where: { id: environmentId },
    });
    if (!env) throw new NotFoundException('Environment not found');
    return env;
  }

  /** Спільна перевірка доступу до оточення з потрібною роллю. */
  private async authorize(
    identityId: string,
    environmentId: string,
    requiredRole: Role,
  ) {
    const env = await this.getEnvironmentOrThrow(environmentId);
    await this.authz.checkAccess(
      identityId,
      env.projectId,
      env.name,
      requiredRole,
    );
    return env;
  }

  async create(
    identityId: string,
    environmentId: string,
    key: string,
    value: string,
  ) {
    // запис вимагає developer+
    await this.authorize(identityId, environmentId, 'developer');

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

  async findByEnvironment(identityId: string, environmentId: string) {
    // читання вимагає readonly+
    await this.authorize(identityId, environmentId, 'readonly');

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

  async remove(identityId: string, id: string) {
    const secret = await this.prisma.secret.findUnique({ where: { id } });
    if (!secret) throw new NotFoundException('Secret not found');

    // видалення вимагає developer+
    await this.authorize(identityId, secret.environmentId, 'developer');

    return this.prisma.secret.delete({ where: { id } });
  }
}
