import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { AuthorizationService, Role } from '../auth/authorization.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class SecretsService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private authz: AuthorizationService,
    private audit: AuditService,
  ) {}

  private async getEnvironmentOrThrow(environmentId: string) {
    const env = await this.prisma.environment.findUnique({
      where: { id: environmentId },
    });
    if (!env) throw new NotFoundException('Environment not found');
    return env;
  }

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
    const env = await this.authorize(identityId, environmentId, 'developer');

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

    const secret = await this.prisma.secret.create({
      data,
      select: { id: true, key: true, environmentId: true, createdAt: true },
    });

    await this.audit.log({
      actorId: identityId,
      action: 'secret.create',
      targetType: 'secret',
      targetId: secret.id,
      metadata: { key, projectId: env.projectId, environment: env.name },
    });

    return secret;
  }

  async findByEnvironment(identityId: string, environmentId: string) {
    const env = await this.authorize(identityId, environmentId, 'readonly');

    const secrets = await this.prisma.secret.findMany({
      where: { environmentId },
    });

    await this.audit.log({
      actorId: identityId,
      action: 'secret.read',
      targetType: 'environment',
      targetId: environmentId,
      metadata: {
        projectId: env.projectId,
        environment: env.name,
        count: secrets.length,
      },
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

    const env = await this.authorize(identityId, secret.environmentId, 'developer');

    await this.prisma.secret.delete({ where: { id } });

    await this.audit.log({
      actorId: identityId,
      action: 'secret.delete',
      targetType: 'secret',
      targetId: id,
      metadata: { key: secret.key, projectId: env.projectId, environment: env.name },
    });

    return { deleted: true };
  }
}
