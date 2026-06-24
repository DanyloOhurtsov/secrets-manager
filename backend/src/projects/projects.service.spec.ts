import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../auth/authorization.service';
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

describe('ProjectsService', () => {
  let service: ProjectsService;
  let prisma: {
    project: { findUnique: jest.Mock };
    organization: { findUnique: jest.Mock };
  };
  let authz: { assertOrganizationAdmin: jest.Mock };

  beforeEach(async () => {
    prisma = {
      project: { findUnique: jest.fn() },
      organization: { findUnique: jest.fn() },
    };
    authz = { assertOrganizationAdmin: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: AuthorizationService, useValue: authz },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('rejects transfer into the same organization', async () => {
    prisma.project.findUnique.mockResolvedValueOnce({
      id: 'p1',
      name: 'app',
      organizationId: 'org-A',
    });
    await expect(service.transfer(actor, 'p1', 'org-A')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(authz.assertOrganizationAdmin).not.toHaveBeenCalled();
  });

  it('rejects transfer when the target has a name collision', async () => {
    prisma.project.findUnique
      .mockResolvedValueOnce({ id: 'p1', name: 'app', organizationId: 'org-A' })
      .mockResolvedValueOnce({ id: 'other', name: 'app' });
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-B' });

    await expect(service.transfer(actor, 'p1', 'org-B')).rejects.toBeInstanceOf(
      ConflictException,
    );
    // admin checked in both source and target before the collision check
    expect(authz.assertOrganizationAdmin).toHaveBeenCalledTimes(2);
  });
});
