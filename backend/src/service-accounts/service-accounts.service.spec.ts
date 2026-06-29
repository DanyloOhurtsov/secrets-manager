import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ServiceAccountsService } from './service-accounts.service';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../auth/authorization.service';
import { TokenService } from '../auth/token.service';
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

describe('ServiceAccountsService', () => {
  let service: ServiceAccountsService;
  let prisma: {
    organization: { findUnique: jest.Mock };
    identity: { count: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let authz: { assertOrganizationAdmin: jest.Mock };
  let audit: { logRequired: jest.Mock; logBestEffort: jest.Mock };
  let tokens: { deleteAllForIdentity: jest.Mock };

  beforeEach(async () => {
    prisma = {
      organization: { findUnique: jest.fn() },
      identity: { count: jest.fn(), create: jest.fn() },
      // Транзакція виконує колбек із prisma-моком як tx (аудит — усередині).
      $transaction: jest
        .fn()
        .mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    authz = { assertOrganizationAdmin: jest.fn().mockResolvedValue(undefined) };
    audit = {
      logRequired: jest.fn().mockResolvedValue(undefined),
      logBestEffort: jest.fn().mockResolvedValue(undefined),
    };
    tokens = { deleteAllForIdentity: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceAccountsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthorizationService, useValue: authz },
        { provide: AuditService, useValue: audit },
        { provide: TokenService, useValue: tokens },
      ],
    }).compile();

    service = module.get<ServiceAccountsService>(ServiceAccountsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('binds new service accounts to the organization', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      type: 'team',
    });
    prisma.identity.create.mockResolvedValue({ id: 'svc-1', name: 'CI' });

    await service.create(actor, 'org-1', 'CI');

    expect(prisma.identity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'service',
          serviceOrganizationId: 'org-1',
        }) as unknown,
      }),
    );
  });

  it('enforces the personal-workspace service-account limit', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      type: 'personal',
    });
    prisma.identity.count.mockResolvedValue(2);

    await expect(service.create(actor, 'org-1', 'CI')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.identity.create).not.toHaveBeenCalled();
  });
});
