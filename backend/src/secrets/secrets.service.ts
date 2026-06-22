import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import {
  AuthorizationService,
  ProjectPermission,
} from '../auth/authorization.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../auth/auth.types';

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
      include: { project: true },
    });
    if (!env) throw new NotFoundException('Environment not found');
    return env;
  }

  private async authorize(
    actor: AuthPrincipal,
    environmentId: string,
    permission: ProjectPermission,
  ) {
    const env = await this.getEnvironmentOrThrow(environmentId);
    await this.authz.checkProjectAccess(
      actor,
      env.projectId,
      permission,
      environmentId,
    );
    return env;
  }

  async create(
    actor: AuthPrincipal,
    environmentId: string,
    key: string,
    value: string,
  ) {
    const env = await this.authorize(actor, environmentId, 'createSecrets');

    const enc = this.crypto.encrypt(value);

    const secret = await this.prisma.$transaction(async (tx) => {
      const created = await tx.secret.create({
        data: {
          key,
          environmentId,
          createdById: actor.id,
        },
      });

      const version = await tx.secretVersion.create({
        data: {
          secretId: created.id,
          version: 1,
          createdById: actor.id,
          ciphertext: enc.ciphertext,
          valueIv: enc.valueIv,
          valueAuthTag: enc.valueAuthTag,
          encryptedDataKey: enc.encryptedDataKey,
          dataKeyIv: enc.dataKeyIv,
          dataKeyAuthTag: enc.dataKeyAuthTag,
          keyVersion: enc.keyVersion,
        },
      });

      return tx.secret.update({
        where: { id: created.id },
        data: { currentVersionId: version.id },
        select: {
          id: true,
          key: true,
          environmentId: true,
          currentVersionId: true,
          createdAt: true,
        },
      });
    });

    await this.audit.log({
      actorId: actor.id,
      organizationId: env.project.organizationId,
      projectId: env.projectId,
      environmentId,
      action: 'secret.create',
      targetType: 'secret',
      targetId: secret.id,
      metadata: { key, version: 1 },
    });

    return secret;
  }

  async findByEnvironment(actor: AuthPrincipal, environmentId: string) {
    const env = await this.authorize(actor, environmentId, 'listSecrets');
    const canReveal = await this.authz.canAccessProject(
      actor,
      env.projectId,
      'revealSecrets',
      environmentId,
    );

    const secrets = await this.prisma.secret.findMany({
      where: { environmentId },
      include: { currentVersion: true },
    });

    await this.audit.log({
      actorId: actor.id,
      organizationId: env.project.organizationId,
      projectId: env.projectId,
      environmentId,
      action: 'secret.list',
      targetType: 'environment',
      targetId: environmentId,
      metadata: {
        count: secrets.length,
        valuesRevealed: canReveal,
      },
    });

    if (canReveal) {
      await this.audit.log({
        actorId: actor.id,
        organizationId: env.project.organizationId,
        projectId: env.projectId,
        environmentId,
        action: 'secret.reveal',
        targetType: 'environment',
        targetId: environmentId,
        metadata: { count: secrets.length },
      });
    }

    return secrets.map((s) => ({
      id: s.id,
      key: s.key,
      currentVersion: s.currentVersion?.version ?? null,
      value:
        canReveal && s.currentVersion
          ? this.crypto.decrypt({
              ciphertext: s.currentVersion.ciphertext,
              valueIv: s.currentVersion.valueIv,
              valueAuthTag: s.currentVersion.valueAuthTag,
              encryptedDataKey: s.currentVersion.encryptedDataKey,
              dataKeyIv: s.currentVersion.dataKeyIv,
              dataKeyAuthTag: s.currentVersion.dataKeyAuthTag,
              keyVersion: s.currentVersion.keyVersion,
            })
          : null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  async remove(actor: AuthPrincipal, id: string) {
    const secret = await this.prisma.secret.findUnique({
      where: { id },
      include: { environment: { include: { project: true } } },
    });
    if (!secret) throw new NotFoundException('Secret not found');

    await this.authz.checkProjectAccess(
      actor,
      secret.environment.projectId,
      'deleteSecrets',
      secret.environmentId,
    );

    await this.prisma.secret.delete({ where: { id } });

    await this.audit.log({
      actorId: actor.id,
      organizationId: secret.environment.project.organizationId,
      projectId: secret.environment.projectId,
      environmentId: secret.environmentId,
      action: 'secret.delete',
      targetType: 'secret',
      targetId: id,
      metadata: { key: secret.key },
    });

    return { deleted: true };
  }
}
