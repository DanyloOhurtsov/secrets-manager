import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
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

  // Дозволи актора в цьому оточенні — фронт ховає кнопки дій, яких немає.
  // Це лише підказка для UI; самі дії гейтить checkProjectAccess на кожному виклику.
  async capabilities(actor: AuthPrincipal, environmentId: string) {
    const env = await this.getEnvironmentOrThrow(environmentId);
    const caps = await this.authz.resolveCapabilities(
      actor,
      env.projectId,
      environmentId,
    );
    return {
      canReveal: caps.revealSecrets,
      canCreate: caps.createSecrets,
      canUpdate: caps.updateSecrets,
      canDelete: caps.deleteSecrets,
      canRollback: caps.rollbackSecrets,
    };
  }

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

  // Завантажує живий (не видалений) секрет разом з його environment/project.
  private async getLiveSecretOrThrow(id: string) {
    const secret = await this.prisma.secret.findUnique({
      where: { id },
      include: { environment: { include: { project: true } } },
    });
    if (!secret || secret.deletedAt) {
      throw new NotFoundException('Secret not found');
    }
    return secret;
  }

  private async nextVersion(tx: Prisma.TransactionClient, secretId: string) {
    const max = await tx.secretVersion.aggregate({
      where: { secretId },
      _max: { version: true },
    });
    return (max._max.version ?? 0) + 1;
  }

  // Розшифрування версії з повним AAD-контекстом (org/secretId/versionId/env).
  // Гілку legacy-vs-v2-vs-v3 обирає CryptoService за encryptionSchemaVersion рядка.
  private decryptVersion(
    organizationId: string,
    secretId: string,
    environmentId: string,
    version: {
      id: string;
      ciphertext: Uint8Array;
      valueIv: Uint8Array;
      valueAuthTag: Uint8Array;
      encryptedDataKey: Uint8Array;
      dataKeyIv: Uint8Array;
      dataKeyAuthTag: Uint8Array;
      keyVersion: string;
      encryptionSchemaVersion: number;
    },
  ): string {
    return this.crypto.decrypt(
      {
        ciphertext: version.ciphertext,
        valueIv: version.valueIv,
        valueAuthTag: version.valueAuthTag,
        encryptedDataKey: version.encryptedDataKey,
        dataKeyIv: version.dataKeyIv,
        dataKeyAuthTag: version.dataKeyAuthTag,
        keyVersion: version.keyVersion,
        encryptionSchemaVersion: version.encryptionSchemaVersion,
      },
      { organizationId, secretId, secretVersionId: version.id, environmentId },
    );
  }

  async create(
    actor: AuthPrincipal,
    environmentId: string,
    key: string,
    value: string,
  ) {
    const env = await this.authorize(actor, environmentId, 'createSecrets');

    // Чи існує секрет з таким ключем (живий або "надгробок")?
    const existing = await this.prisma.secret.findUnique({
      where: { environmentId_key: { environmentId, key } },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException('Secret with this key already exists');
    }

    // Прегенеруємо ID секрету/версії, щоб AAD прив'язалась до тих самих рядків,
    // у яких конверт буде збережено (значення вже шифрується під цей контекст).
    const secretId = existing ? existing.id : randomUUID();
    const secretVersionId = randomUUID();
    const enc = this.crypto.encrypt(value, {
      organizationId: env.project.organizationId,
      secretId,
      secretVersionId,
      environmentId,
    });

    const secret = await this.prisma.$transaction(async (tx) => {
      // Якщо є надгробок — оживляємо його, інакше створюємо новий секрет.
      const base = existing
        ? existing
        : await tx.secret.create({
            data: { id: secretId, key, environmentId, createdById: actor.id },
          });

      const version = await tx.secretVersion.create({
        data: {
          id: secretVersionId,
          secretId: base.id,
          version: existing ? await this.nextVersion(tx, base.id) : 1,
          createdById: actor.id,
          ...enc,
        },
      });

      const updated = await tx.secret.update({
        where: { id: base.id },
        data: { currentVersionId: version.id, deletedAt: null },
        select: {
          id: true,
          key: true,
          environmentId: true,
          currentVersionId: true,
          createdAt: true,
        },
      });

      // Аудит — у ТІЙ САМІЙ транзакції: збій журналу відкочує секрет і версію.
      await this.audit.logRequired(
        {
          actorId: actor.id,
          organizationId: env.project.organizationId,
          projectId: env.projectId,
          environmentId,
          action: 'secret.create',
          targetType: 'secret',
          targetId: updated.id,
          metadata: { key, revived: !!existing },
        },
        tx,
      );

      return updated;
    });

    return secret;
  }

  async update(actor: AuthPrincipal, id: string, value: string) {
    const secret = await this.getLiveSecretOrThrow(id);
    await this.authz.checkProjectAccess(
      actor,
      secret.environment.projectId,
      'updateSecrets',
      secret.environmentId,
    );

    const secretVersionId = randomUUID();
    const enc = this.crypto.encrypt(value, {
      organizationId: secret.environment.project.organizationId,
      secretId: secret.id,
      secretVersionId,
      environmentId: secret.environmentId,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const version = await tx.secretVersion.create({
        data: {
          id: secretVersionId,
          secretId: secret.id,
          version: await this.nextVersion(tx, secret.id),
          createdById: actor.id,
          ...enc,
        },
      });
      const updated = await tx.secret.update({
        where: { id: secret.id },
        data: { currentVersionId: version.id },
        select: {
          id: true,
          key: true,
          environmentId: true,
          currentVersionId: true,
          updatedAt: true,
        },
      });

      // Аудит у тій самій транзакції: збій журналу відкочує нову версію.
      await this.audit.logRequired(
        {
          actorId: actor.id,
          organizationId: secret.environment.project.organizationId,
          projectId: secret.environment.projectId,
          environmentId: secret.environmentId,
          action: 'secret.version.create', // секрет оновлено — критична мутація
          targetType: 'secret',
          targetId: secret.id,
          metadata: { key: secret.key },
        },
        tx,
      );

      return updated;
    });

    return result;
  }

  async listVersions(actor: AuthPrincipal, id: string) {
    const secret = await this.getLiveSecretOrThrow(id);
    await this.authz.checkProjectAccess(
      actor,
      secret.environment.projectId,
      'listSecrets',
      secret.environmentId,
    );

    const versions = await this.prisma.secretVersion.findMany({
      where: { secretId: secret.id },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        createdById: true,
        createdAt: true,
        note: true,
        keyVersion: true,
      },
    });

    return versions.map((v) => ({
      ...v,
      isCurrent: v.id === secret.currentVersionId,
    }));
  }

  async rollback(actor: AuthPrincipal, id: string, toVersion: number) {
    const secret = await this.getLiveSecretOrThrow(id);
    await this.authz.checkProjectAccess(
      actor,
      secret.environment.projectId,
      'rollbackSecrets',
      secret.environmentId,
    );

    const target = await this.prisma.secretVersion.findUnique({
      where: { secretId_version: { secretId: secret.id, version: toVersion } },
    });
    if (!target) throw new NotFoundException('Target version not found');

    // Rollback = нова версія з тим самим значенням, історія лишається чесною.
    // AAD прив'язує конверт до конкретного версійного рядка, тож просто скопіювати
    // байти старої версії не можна (інша версія → інша AAD → integrity-failure).
    // Розшифровуємо цільову версію (плейнтекст лишається на сервері, назад не
    // повертається) і перешифровуємо під контекст нової версії. Наслідок: нова
    // версія завжди пишеться як AAD-схема (v2), навіть якщо ціль була legacy.
    const plaintext = this.decryptVersion(
      secret.environment.project.organizationId,
      secret.id,
      secret.environmentId,
      target,
    );
    const secretVersionId = randomUUID();
    const enc = this.crypto.encrypt(plaintext, {
      organizationId: secret.environment.project.organizationId,
      secretId: secret.id,
      secretVersionId,
      environmentId: secret.environmentId,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const version = await tx.secretVersion.create({
        data: {
          id: secretVersionId,
          secretId: secret.id,
          version: await this.nextVersion(tx, secret.id),
          createdById: actor.id,
          note: `rollback to v${toVersion}`,
          ...enc,
        },
      });
      const updated = await tx.secret.update({
        where: { id: secret.id },
        data: { currentVersionId: version.id },
        select: {
          id: true,
          key: true,
          environmentId: true,
          currentVersionId: true,
          updatedAt: true,
        },
      });

      // Аудит у тій самій транзакції: збій журналу відкочує rollback.
      await this.audit.logRequired(
        {
          actorId: actor.id,
          organizationId: secret.environment.project.organizationId,
          projectId: secret.environment.projectId,
          environmentId: secret.environmentId,
          action: 'secret.rollback',
          targetType: 'secret',
          targetId: secret.id,
          metadata: { key: secret.key, fromVersion: toVersion },
        },
        tx,
      );

      return updated;
    });

    return result;
  }

  async findByEnvironment(
    actor: AuthPrincipal,
    environmentId: string,
    reveal = false,
  ) {
    const env = await this.authorize(actor, environmentId, 'listSecrets');
    const canReveal = await this.authz.canAccessProject(
      actor,
      env.projectId,
      'revealSecrets',
      environmentId,
    );

    const secrets = await this.prisma.secret.findMany({
      where: { environmentId, deletedAt: null },
      include: { currentVersion: true },
    });

    // Значення повертаємо й логуємо reveal ЛИШЕ коли клієнт явно просить
    // (CLI / bulk-pull). Звичайне відкриття сторінки — це secret.list, не reveal.
    const revealValues = reveal && canReveal;

    // secret.list — read-only метадані (ключі без значень): best-effort, не
    // валимо звичайний перегляд сторінки через збій журналу.
    await this.audit.logBestEffort({
      actorId: actor.id,
      organizationId: env.project.organizationId,
      projectId: env.projectId,
      environmentId,
      action: 'secret.list',
      targetType: 'environment',
      targetId: environmentId,
      metadata: { count: secrets.length, revealed: revealValues },
    });

    // secret.reveal — критично: пишемо журнал ПЕРЕД розшифруванням значень нижче.
    // Якщо logRequired кине 503, мапа з decrypt() не виконається — плейнтекст не
    // покине сервер.
    if (revealValues) {
      await this.audit.logRequired({
        actorId: actor.id,
        organizationId: env.project.organizationId,
        projectId: env.projectId,
        environmentId,
        action: 'secret.reveal',
        targetType: 'environment',
        targetId: environmentId,
        metadata: { count: secrets.length, bulk: true },
      });
    }

    return secrets.map((s) => ({
      id: s.id,
      key: s.key,
      currentVersion: s.currentVersion?.version ?? null,
      canReveal,
      value:
        revealValues && s.currentVersion
          ? this.decryptVersion(
              env.project.organizationId,
              s.id,
              environmentId,
              s.currentVersion,
            )
          : null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  // Явний reveal одного секрету — це і є момент, коли плейнтекст залишає сервер.
  async revealOne(actor: AuthPrincipal, id: string) {
    const secret = await this.prisma.secret.findUnique({
      where: { id },
      include: {
        environment: { include: { project: true } },
        currentVersion: true,
      },
    });
    if (!secret || secret.deletedAt) {
      throw new NotFoundException('Secret not found');
    }

    await this.authz.checkProjectAccess(
      actor,
      secret.environment.projectId,
      'revealSecrets',
      secret.environmentId,
    );

    if (!secret.currentVersion) return { id: secret.id, value: null };

    // Спершу — обов'язковий запис у журнал, і ЛИШЕ потім розшифрування. Якщо
    // аудит впав (503), плейнтекст не розшифровується й не повертається.
    await this.audit.logRequired({
      actorId: actor.id,
      organizationId: secret.environment.project.organizationId,
      projectId: secret.environment.projectId,
      environmentId: secret.environmentId,
      action: 'secret.reveal',
      targetType: 'secret',
      targetId: secret.id,
      metadata: { key: secret.key, version: secret.currentVersion.version },
    });

    const value = this.decryptVersion(
      secret.environment.project.organizationId,
      secret.id,
      secret.environmentId,
      secret.currentVersion,
    );

    return { id: secret.id, value };
  }

  async remove(actor: AuthPrincipal, id: string) {
    const secret = await this.getLiveSecretOrThrow(id);

    await this.authz.checkProjectAccess(
      actor,
      secret.environment.projectId,
      'deleteSecrets',
      secret.environmentId,
    );

    // М'яке видалення + аудит атомарно: збій журналу відкочує видалення.
    await this.prisma.$transaction(async (tx) => {
      await tx.secret.update({
        where: { id },
        data: { deletedAt: new Date(), currentVersionId: null },
      });
      await this.audit.logRequired(
        {
          actorId: actor.id,
          organizationId: secret.environment.project.organizationId,
          projectId: secret.environment.projectId,
          environmentId: secret.environmentId,
          action: 'secret.delete',
          targetType: 'secret',
          targetId: id,
          metadata: { key: secret.key },
        },
        tx,
      );
    });

    return { deleted: true };
  }
}
