import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../auth/authorization.service';
import { AuthPrincipal } from '../auth/auth.types';

function human(overrides: Partial<AuthPrincipal> = {}): AuthPrincipal {
  return {
    id: 'actor-1',
    name: 'Actor',
    email: 'actor@example.com',
    type: 'human',
    isSuperadmin: false,
    serviceOrganizationId: null,
    authMethod: 'session',
    ...overrides,
  };
}

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let prisma: {
    organization: { findUnique: jest.Mock };
    identity: { findUnique: jest.Mock };
    organizationMembership: {
      findUnique: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let authz: {
    assertOrganizationAdmin: jest.Mock;
    assertOrganizationOwner: jest.Mock;
    assertOrganizationMember: jest.Mock;
  };
  let audit: { logRequired: jest.Mock; logBestEffort: jest.Mock };

  beforeEach(async () => {
    prisma = {
      organization: { findUnique: jest.fn() },
      identity: { findUnique: jest.fn() },
      organizationMembership: {
        findUnique: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      // Транзакція виконує колбек із prisma-моком як tx (аудит — усередині).
      $transaction: jest
        .fn()
        .mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    authz = {
      assertOrganizationAdmin: jest.fn().mockResolvedValue(undefined),
      assertOrganizationOwner: jest.fn().mockResolvedValue(undefined),
      assertOrganizationMember: jest.fn().mockResolvedValue('owner'),
    };
    audit = {
      logRequired: jest.fn().mockResolvedValue(undefined),
      logBestEffort: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthorizationService, useValue: authz },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<OrganizationsService>(OrganizationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('rejects organization creation by service accounts', async () => {
    await expect(
      service.createTeam(human({ type: 'service' }), 'Acme'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires owner role to add an admin member', async () => {
    authz.assertOrganizationOwner.mockRejectedValueOnce(
      new ForbiddenException(),
    );
    await expect(
      service.addMember(human(), 'org-1', 'new@example.com', 'admin'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(authz.assertOrganizationOwner).toHaveBeenCalled();
  });

  // Required proof #3: membership.role_change audit failure rolls back the role.
  it('rolls back the role change when the required audit write fails (transaction-level)', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      type: 'team',
    });
    prisma.organizationMembership.findUnique.mockResolvedValue({
      id: 'mem-1',
      role: 'member',
    });

    let committed = false;
    prisma.$transaction.mockImplementationOnce(
      async (cb: (tx: unknown) => unknown) => {
        const tx = {
          organizationMembership: {
            update: jest.fn().mockResolvedValue({ id: 'mem-1', role: 'admin' }),
          },
        };
        const result = await cb(tx); // audit кидає → коміт недосяжний
        committed = true;
        return result;
      },
    );
    audit.logRequired.mockRejectedValueOnce(
      new ServiceUnavailableException('Audit log unavailable'),
    );

    await expect(
      service.changeRole(human(), 'org-1', 'target-id', 'admin'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    // Транзакція не закомічена → роль не змінено (відкат).
    expect(committed).toBe(false);
  });

  // Required proof: organization.delete audit failure rolls back the deletion.
  it('rolls back the organization deletion when the required audit write fails (transaction-level)', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      name: 'Acme',
      type: 'team',
      _count: { projects: 0, serviceAccounts: 0 },
    });

    let committed = false;
    const txDelete = jest.fn().mockResolvedValue({ id: 'org-1' });
    prisma.$transaction.mockImplementationOnce(
      async (cb: (tx: unknown) => unknown) => {
        const tx = { organization: { delete: txDelete } };
        const result = await cb(tx); // audit кидає → delete недосяжний
        committed = true;
        return result;
      },
    );
    audit.logRequired.mockRejectedValueOnce(
      new ServiceUnavailableException('Audit log unavailable'),
    );

    await expect(
      service.remove(human(), 'org-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    // Аудит пишемо перед delete → збій журналу не дає видалити org.
    expect(txDelete).not.toHaveBeenCalled();
    // Транзакція не закомічена → org не видалено (відкат).
    expect(committed).toBe(false);
  });

  it('enforces the personal-workspace collaborator limit', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      type: 'personal',
    });
    prisma.identity.findUnique.mockResolvedValue({
      id: 'id-2',
      type: 'human',
      name: 'Bob',
      email: 'bob@example.com',
    });
    prisma.organizationMembership.findUnique.mockResolvedValue(null);
    prisma.organizationMembership.count.mockResolvedValue(2);

    await expect(
      service.addMember(human(), 'org-1', 'bob@example.com', 'member'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
