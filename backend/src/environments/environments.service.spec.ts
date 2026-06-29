import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { EnvironmentsService } from './environments.service';
import { PrismaService } from '../prisma.service';
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

const allEnvs = [
  { id: 'env-prod', name: 'production', projectId: 'proj-1' },
  { id: 'env-staging', name: 'staging', projectId: 'proj-1' },
];

describe('EnvironmentsService', () => {
  let service: EnvironmentsService;
  let prisma: {
    environment: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let authz: {
    getProjectForActor: jest.Mock;
    environmentScopeForActor: jest.Mock;
    checkProjectAccess: jest.Mock;
  };
  let audit: { logRequired: jest.Mock; logBestEffort: jest.Mock };

  beforeEach(async () => {
    prisma = {
      environment: {
        findMany: jest.fn().mockResolvedValue(allEnvs),
        findUnique: jest.fn().mockResolvedValue({
          id: 'env-prod',
          name: 'production',
          projectId: 'proj-1',
          project: { id: 'proj-1', organizationId: 'org-1' },
        }),
        update: jest.fn().mockResolvedValue({
          id: 'env-prod',
          name: 'prod',
          projectId: 'proj-1',
        }),
        create: jest.fn().mockResolvedValue({
          id: 'env-new',
          name: 'qa',
          projectId: 'proj-1',
        }),
        delete: jest.fn().mockResolvedValue({ id: 'env-prod' }),
      },
      // Транзакція виконує колбек із prisma-моком як tx (аудит — усередині).
      $transaction: jest
        .fn()
        .mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    authz = {
      getProjectForActor: jest
        .fn()
        .mockResolvedValue({ id: 'proj-1', organizationId: 'org-1' }),
      environmentScopeForActor: jest.fn(),
      checkProjectAccess: jest.fn().mockResolvedValue(undefined),
    };
    audit = {
      logRequired: jest.fn().mockResolvedValue(undefined),
      logBestEffort: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnvironmentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthorizationService, useValue: authz },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<EnvironmentsService>(EnvironmentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns every environment when the actor has full project scope', async () => {
    authz.environmentScopeForActor.mockResolvedValue('all');
    await expect(service.findByProject(actor, 'proj-1')).resolves.toEqual(
      allEnvs,
    );
  });

  it('returns only the environments the actor is scoped to', async () => {
    authz.environmentScopeForActor.mockResolvedValue(new Set(['env-prod']));
    await expect(service.findByProject(actor, 'proj-1')).resolves.toEqual([
      allEnvs[0],
    ]);
  });

  it('returns nothing when the actor is scoped to no environment in this project', async () => {
    authz.environmentScopeForActor.mockResolvedValue(new Set<string>());
    await expect(service.findByProject(actor, 'proj-1')).resolves.toEqual([]);
  });

  it('renames an environment and audits the change', async () => {
    await expect(service.rename(actor, 'env-prod', 'prod')).resolves.toEqual({
      id: 'env-prod',
      name: 'prod',
      projectId: 'proj-1',
    });
    expect(authz.checkProjectAccess).toHaveBeenCalledWith(
      actor,
      'proj-1',
      'manageProject',
    );
    expect(prisma.environment.update).toHaveBeenCalledWith({
      where: { id: 'env-prod' },
      data: { name: 'prod' },
    });
    expect(audit.logRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'environment.update',
        metadata: { from: 'production', to: 'prod' },
      }),
      expect.anything(), // транзакційний клієнт (аудит у тій самій транзакції)
    );
  });

  it('rejects renaming to a name already used in the project', async () => {
    prisma.environment.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(service.rename(actor, 'env-prod', 'staging')).rejects.toThrow(
      ConflictException,
    );
    expect(audit.logRequired).not.toHaveBeenCalled();
  });
});
