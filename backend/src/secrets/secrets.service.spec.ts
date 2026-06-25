import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SecretsService } from './secrets.service';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { AuthorizationService } from '../auth/authorization.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../auth/auth.types';

const actor: AuthPrincipal = {
  id: 'actor-1',
  name: 'Actor',
  email: 'actor@example.com',
  type: 'human',
  isSuperadmin: false,
  serviceOrganizationId: null,
  authMethod: 'session',
};

const liveEnv = {
  id: 'env-1',
  projectId: 'proj-1',
  project: { id: 'proj-1', organizationId: 'org-1' },
};

describe('SecretsService', () => {
  let service: SecretsService;
  let prisma: {
    environment: { findUnique: jest.Mock };
    secret: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    secretVersion: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let authz: { checkProjectAccess: jest.Mock; canAccessProject: jest.Mock };
  let crypto: { encrypt: jest.Mock; decrypt: jest.Mock };
  let audit: { logRequired: jest.Mock; logBestEffort: jest.Mock };

  beforeEach(async () => {
    prisma = {
      environment: { findUnique: jest.fn().mockResolvedValue(liveEnv) },
      secret: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({ id: 's1' }),
      },
      secretVersion: { findUnique: jest.fn() },
      // Виконуємо колбек із tx-моком: аудит тепер ВСЕРЕДИНІ транзакції, тож
      // його збій має кинути з колбека (емуляція відкату).
      $transaction: jest
        .fn()
        .mockImplementation((cb: (tx: unknown) => unknown) =>
          cb({
            secret: {
              create: jest.fn().mockResolvedValue({ id: 's1' }),
              update: jest.fn().mockResolvedValue({
                id: 's1',
                key: 'API_KEY',
                environmentId: 'env-1',
                currentVersionId: 'v2',
              }),
            },
            secretVersion: {
              create: jest.fn().mockResolvedValue({ id: 'v2', version: 2 }),
              aggregate: jest.fn().mockResolvedValue({ _max: { version: 1 } }),
            },
          }),
        ),
    };
    authz = {
      checkProjectAccess: jest.fn().mockResolvedValue(undefined),
      canAccessProject: jest.fn().mockResolvedValue(false),
    };
    crypto = {
      encrypt: jest.fn().mockReturnValue({}),
      decrypt: jest.fn().mockReturnValue('PLAINTEXT'),
    };
    audit = {
      logRequired: jest.fn().mockResolvedValue(undefined),
      logBestEffort: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: crypto },
        { provide: AuthorizationService, useValue: authz },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<SecretsService>(SecretsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('rejects creating a key that already exists (live)', async () => {
    prisma.secret.findUnique.mockResolvedValue({ id: 's1', deletedAt: null });
    await expect(
      service.create(actor, 'env-1', 'API_KEY', 'v'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('treats a soft-deleted secret as not found for updates', async () => {
    prisma.secret.findUnique.mockResolvedValue({
      id: 's1',
      deletedAt: new Date(),
      environment: liveEnv,
    });
    await expect(service.update(actor, 's1', 'new')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(authz.checkProjectAccess).not.toHaveBeenCalled();
  });

  it('fails rollback to a non-existent version', async () => {
    prisma.secret.findUnique.mockResolvedValue({
      id: 's1',
      key: 'API_KEY',
      deletedAt: null,
      currentVersionId: 'v3',
      environmentId: 'env-1',
      environment: liveEnv,
    });
    prisma.secretVersion.findUnique.mockResolvedValue(null);
    await expect(service.rollback(actor, 's1', 99)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // --- AAD-привʼязка: контекст шифрування та маркер схеми ---
  describe('AAD context binding', () => {
    it('binds AAD context and marks new versions with encryption schema v2', async () => {
      prisma.secret.findUnique.mockResolvedValue(null);
      crypto.encrypt.mockReturnValue({
        encryptionSchemaVersion: 2,
        keyVersion: 'v1',
      });

      const versionCreate = jest
        .fn()
        .mockResolvedValue({ id: 'v1', version: 1 });
      prisma.$transaction.mockImplementationOnce(
        (cb: (tx: unknown) => unknown) =>
          cb({
            secret: {
              create: jest.fn().mockResolvedValue({ id: 'sX' }),
              update: jest.fn().mockResolvedValue({
                id: 'sX',
                key: 'API_KEY',
                environmentId: 'env-1',
                currentVersionId: 'v1',
              }),
            },
            secretVersion: {
              create: versionCreate,
              aggregate: jest.fn().mockResolvedValue({ _max: { version: 0 } }),
            },
          }),
      );

      await service.create(actor, 'env-1', 'API_KEY', 'val');

      // encrypt отримує стабільний контекст, а не голе значення.
      const ctxMatcher: unknown = expect.objectContaining({
        secretId: expect.any(String) as unknown,
        secretVersionId: expect.any(String) as unknown,
        environmentId: 'env-1',
      });
      expect(crypto.encrypt).toHaveBeenCalledWith('val', ctxMatcher);
      // Рядок версії збережено з encryptionSchemaVersion = 2.
      const versionDataMatcher: unknown = expect.objectContaining({
        data: expect.objectContaining({
          encryptionSchemaVersion: 2,
        }) as unknown,
      });
      expect(versionCreate).toHaveBeenCalledWith(versionDataMatcher);
    });

    it('reveal threads the schema version + AAD context to decrypt (legacy and v2)', async () => {
      const envelope = {
        ciphertext: Buffer.from(''),
        valueIv: Buffer.from(''),
        valueAuthTag: Buffer.from(''),
        encryptedDataKey: Buffer.from(''),
        dataKeyIv: Buffer.from(''),
        dataKeyAuthTag: Buffer.from(''),
        keyVersion: 'v1',
      };

      for (const schema of [1, 2]) {
        crypto.decrypt.mockClear().mockReturnValue('PLAINTEXT');
        prisma.secret.findUnique.mockResolvedValue({
          id: 's1',
          key: 'API_KEY',
          deletedAt: null,
          environmentId: 'env-1',
          environment: {
            projectId: 'proj-1',
            project: { id: 'proj-1', organizationId: 'org-1' },
          },
          currentVersion: {
            id: 'ver-1',
            version: 1,
            ...envelope,
            encryptionSchemaVersion: schema,
          },
        });

        const res = await service.revealOne(actor, 's1');
        expect(res.value).toBe('PLAINTEXT');
        // Схема рядка й повний контекст передаються в crypto.decrypt → працює
        // і для legacy (1), і для AAD (2).
        expect(crypto.decrypt).toHaveBeenCalledWith(
          expect.objectContaining({
            encryptionSchemaVersion: schema,
            keyVersion: 'v1',
          }),
          { secretId: 's1', secretVersionId: 'ver-1', environmentId: 'env-1' },
        );
      }
    });
  });

  // --- Fail-closed audit для критичних дій із секретами ---
  describe('fail-closed audit', () => {
    const liveSecret = {
      id: 's1',
      key: 'API_KEY',
      deletedAt: null,
      currentVersionId: 'v2',
      environmentId: 'env-1',
      environment: {
        projectId: 'proj-1',
        project: { id: 'proj-1', organizationId: 'org-1' },
      },
      currentVersion: {
        version: 2,
        ciphertext: Buffer.from(''),
        valueIv: Buffer.from(''),
        valueAuthTag: Buffer.from(''),
        encryptedDataKey: Buffer.from(''),
        dataKeyIv: Buffer.from(''),
        dataKeyAuthTag: Buffer.from(''),
        keyVersion: 'v1',
      },
    };

    const auditDown = () =>
      audit.logRequired.mockRejectedValue(
        new ServiceUnavailableException('Audit log unavailable'),
      );

    it('reveal: does NOT decrypt or return plaintext when the required audit fails', async () => {
      prisma.secret.findUnique.mockResolvedValue(liveSecret);
      auditDown();

      await expect(service.revealOne(actor, 's1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      // Найважливіше: плейнтекст не розшифровано (тобто не залишив сервер).
      expect(crypto.decrypt).not.toHaveBeenCalled();
    });

    it('create: fails when the required audit fails', async () => {
      prisma.secret.findUnique.mockResolvedValue(null); // нема наявного ключа
      auditDown();

      await expect(
        service.create(actor, 'env-1', 'API_KEY', 'val'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    // Required proof #2: a failed audit rolls back the secret + version.
    it('create: rolls back the secret/version when the required audit fails (transaction-level)', async () => {
      prisma.secret.findUnique.mockResolvedValue(null);

      let committed = false;
      prisma.$transaction.mockImplementationOnce(
        async (cb: (tx: unknown) => unknown) => {
          const tx = {
            secret: {
              create: jest.fn().mockResolvedValue({ id: 's1' }),
              update: jest.fn().mockResolvedValue({
                id: 's1',
                key: 'API_KEY',
                environmentId: 'env-1',
                currentVersionId: 'v2',
              }),
            },
            secretVersion: {
              create: jest.fn().mockResolvedValue({ id: 'v2' }),
              aggregate: jest.fn().mockResolvedValue({ _max: { version: 0 } }),
            },
          };
          const result = await cb(tx); // audit кидає → коміт недосяжний
          committed = true;
          return result;
        },
      );
      auditDown();

      await expect(
        service.create(actor, 'env-1', 'API_KEY', 'val'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(committed).toBe(false); // транзакція не закомічена → відкат
    });

    it('update: fails when the required audit fails', async () => {
      prisma.secret.findUnique.mockResolvedValue(liveSecret);
      auditDown();

      await expect(service.update(actor, 's1', 'val')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('delete: fails when the required audit fails', async () => {
      prisma.secret.findUnique.mockResolvedValue(liveSecret);
      auditDown();

      await expect(service.remove(actor, 's1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('rollback: fails when the required audit fails', async () => {
      prisma.secret.findUnique.mockResolvedValue(liveSecret);
      prisma.secretVersion.findUnique.mockResolvedValue(
        liveSecret.currentVersion,
      );
      auditDown();

      await expect(service.rollback(actor, 's1', 1)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('list stays best-effort: secret.list uses logBestEffort, never logRequired', async () => {
      prisma.secret.findMany.mockResolvedValue([]);

      await service.findByEnvironment(actor, 'env-1', false);

      expect(audit.logBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'secret.list' }),
      );
      // Перегляд списку (без reveal) не пише обов'язкового аудиту.
      expect(audit.logRequired).not.toHaveBeenCalled();
    });
  });
});
