import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
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
    organizationMembership: { findUnique: jest.Mock; count: jest.Mock };
  };
  let authz: {
    assertOrganizationAdmin: jest.Mock;
    assertOrganizationOwner: jest.Mock;
    assertOrganizationMember: jest.Mock;
  };
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = {
      organization: { findUnique: jest.fn() },
      identity: { findUnique: jest.fn() },
      organizationMembership: { findUnique: jest.fn(), count: jest.fn() },
    };
    authz = {
      assertOrganizationAdmin: jest.fn().mockResolvedValue(undefined),
      assertOrganizationOwner: jest.fn().mockResolvedValue(undefined),
      assertOrganizationMember: jest.fn().mockResolvedValue('owner'),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

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
