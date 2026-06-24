import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
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
    secret: { findUnique: jest.Mock };
    secretVersion: { findUnique: jest.Mock };
  };
  let authz: { checkProjectAccess: jest.Mock; canAccessProject: jest.Mock };

  beforeEach(async () => {
    prisma = {
      environment: { findUnique: jest.fn().mockResolvedValue(liveEnv) },
      secret: { findUnique: jest.fn() },
      secretVersion: { findUnique: jest.fn() },
    };
    authz = {
      checkProjectAccess: jest.fn().mockResolvedValue(undefined),
      canAccessProject: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: {} },
        { provide: AuthorizationService, useValue: authz },
        { provide: AuditService, useValue: { log: jest.fn() } },
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
});
