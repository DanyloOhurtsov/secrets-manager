import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GrantsService } from './grants.service';
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

describe('GrantsService', () => {
  let service: GrantsService;
  let prisma: {
    project: { findUnique: jest.Mock };
    identity: { findUnique: jest.Mock };
    environment: { findFirst: jest.Mock };
    organizationMembership: { findUnique: jest.Mock };
    grant: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let authz: {
    assertOrganizationAdmin: jest.Mock;
  };
  let audit: { logRequired: jest.Mock; logBestEffort: jest.Mock };

  beforeEach(async () => {
    prisma = {
      project: { findUnique: jest.fn() },
      identity: { findUnique: jest.fn() },
      environment: { findFirst: jest.fn() },
      organizationMembership: { findUnique: jest.fn() },
      grant: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      // За замовчуванням транзакція виконує колбек із самим prisma-моком як tx,
      // тож існуючі assertions на prisma.grant.* лишаються чинними, а
      // audit.logRequired(entry, tx) викликається всередині транзакції.
      $transaction: jest
        .fn()
        .mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    authz = {
      assertOrganizationAdmin: jest.fn().mockResolvedValue(undefined),
    };
    audit = {
      logRequired: jest.fn().mockResolvedValue(undefined),
      logBestEffort: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrantsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthorizationService, useValue: authz },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<GrantsService>(GrantsService);
  });

  // Спільний happy-path сетап: проєкт належить org-1, grantee — її людина-член.
  function arrangeProjectAndMember() {
    prisma.project.findUnique.mockResolvedValue({
      id: 'proj-1',
      organizationId: 'org-1',
    });
    prisma.identity.findUnique.mockResolvedValue({
      id: 'id-2',
      type: 'human',
      serviceOrganizationId: null,
    });
    prisma.organizationMembership.findUnique.mockResolvedValue({ id: 'mem-1' });
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --- H1: grant CRUD — лише org owner/admin; canManageGrants не рятує ---

  it('denies grant creation when the actor is not an org owner/admin (canManageGrants does not help)', async () => {
    // Симулюємо звичайного учасника/девелопера, навіть якщо в нього є грант із
    // canManageGrants: assertOrganizationAdmin кидає Forbidden.
    authz.assertOrganizationAdmin.mockRejectedValueOnce(
      new ForbiddenException(),
    );

    await expect(
      service.create(actor, 'org-1', {
        identityId: 'id-2',
        projectId: 'proj-1',
        role: 'viewer',
        canManageGrants: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(authz.assertOrganizationAdmin).toHaveBeenCalledWith(
      'actor-1',
      'org-1',
    );
    // Перевірка ролі — ПЕРШОЮ: жодного запиту до проєкту/гранту, нічого не створено.
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
    expect(prisma.grant.create).not.toHaveBeenCalled();
  });

  it('denies a non-admin actor creating a reveal/admin grant for themselves', async () => {
    authz.assertOrganizationAdmin.mockRejectedValueOnce(
      new ForbiddenException(),
    );

    await expect(
      service.create(actor, 'org-1', {
        identityId: actor.id, // себе
        projectId: 'proj-1',
        role: 'admin',
        canRevealSecrets: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.grant.create).not.toHaveBeenCalled();
  });

  it('denies a non-admin actor updating a grant to add canRevealSecrets (self-escalation)', async () => {
    authz.assertOrganizationAdmin.mockRejectedValueOnce(
      new ForbiddenException(),
    );

    await expect(
      service.update(actor, 'org-1', 'grant-1', { canRevealSecrets: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Грант навіть не завантажується — існування не підтверджуємо неадміну.
    expect(prisma.grant.findUnique).not.toHaveBeenCalled();
    expect(prisma.grant.update).not.toHaveBeenCalled();
  });

  it('denies a non-admin actor revoking a grant', async () => {
    authz.assertOrganizationAdmin.mockRejectedValueOnce(
      new ForbiddenException(),
    );

    await expect(
      service.revoke(actor, 'org-1', 'grant-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.grant.findUnique).not.toHaveBeenCalled();
    expect(prisma.grant.delete).not.toHaveBeenCalled();
  });

  it('creates an initial project grant for an org member and audits it', async () => {
    arrangeProjectAndMember();
    prisma.grant.create.mockResolvedValue({
      id: 'grant-1',
      scopeType: 'project',
      scopeId: 'proj-1',
    });

    await service.create(actor, 'org-1', {
      identityId: 'id-2',
      projectId: 'proj-1',
      role: 'developer',
    });

    // Developer за замовчуванням не отримує жодної capability на значення.
    const developerData: unknown = expect.objectContaining({
      role: 'developer',
      canRevealSecrets: false,
      canUpdateSecrets: false,
      canCreateSecrets: false,
      canDeleteSecrets: false,
      canRollbackSecrets: false,
      canManageGrants: false,
    });
    expect(prisma.grant.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: developerData }),
    );
    expect(audit.logRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'grant.create',
        organizationId: 'org-1',
        projectId: 'proj-1',
      }),
      expect.anything(), // транзакційний клієнт
    );
  });

  it('admin grant defaults every capability to true', async () => {
    arrangeProjectAndMember();
    prisma.grant.create.mockResolvedValue({
      id: 'grant-1',
      scopeType: 'project',
      scopeId: 'proj-1',
    });

    await service.create(actor, 'org-1', {
      identityId: 'id-2',
      projectId: 'proj-1',
      role: 'admin',
    });

    const adminData: unknown = expect.objectContaining({
      role: 'admin',
      canRevealSecrets: true,
      canCreateSecrets: true,
      canUpdateSecrets: true,
      canDeleteSecrets: true,
      canRollbackSecrets: true,
      canManageGrants: true,
    });
    expect(prisma.grant.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: adminData }),
    );
  });

  it('rejects a project that does not belong to the organization', async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: 'proj-1',
      organizationId: 'other-org',
    });

    await expect(
      service.create(actor, 'org-1', {
        identityId: 'id-2',
        projectId: 'proj-1',
        role: 'viewer',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.grant.create).not.toHaveBeenCalled();
  });

  it('rejects granting access to an identity outside the organization', async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: 'proj-1',
      organizationId: 'org-1',
    });
    prisma.identity.findUnique.mockResolvedValue({
      id: 'outsider',
      type: 'human',
      serviceOrganizationId: null,
    });
    prisma.organizationMembership.findUnique.mockResolvedValue(null);

    await expect(
      service.create(actor, 'org-1', {
        identityId: 'outsider',
        projectId: 'proj-1',
        role: 'reader',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.grant.create).not.toHaveBeenCalled();
  });

  it('rejects granting access to a service account from another organization', async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: 'proj-1',
      organizationId: 'org-1',
    });
    prisma.identity.findUnique.mockResolvedValue({
      id: 'svc-1',
      type: 'service',
      serviceOrganizationId: 'other-org',
    });

    await expect(
      service.create(actor, 'org-1', {
        identityId: 'svc-1',
        projectId: 'proj-1',
        role: 'reader',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.grant.create).not.toHaveBeenCalled();
  });

  it('normalizes the legacy "readonly" role to "reader"', async () => {
    arrangeProjectAndMember();
    prisma.grant.create.mockResolvedValue({
      id: 'grant-1',
      scopeType: 'project',
      scopeId: 'proj-1',
    });

    await service.create(actor, 'org-1', {
      identityId: 'id-2',
      projectId: 'proj-1',
      role: 'readonly',
    });

    const readerData: unknown = expect.objectContaining({ role: 'reader' });
    expect(prisma.grant.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: readerData }),
    );
  });

  // Спільний сетап для update: грант на весь проєкт proj-1 в org-1.
  function arrangeWholeProjectGrant() {
    prisma.grant.findUnique.mockResolvedValue({
      id: 'grant-1',
      identityId: 'id-2',
      projectId: 'proj-1',
      scopeType: 'project',
      scopeId: 'proj-1',
    });
    prisma.project.findUnique.mockResolvedValue({
      id: 'proj-1',
      organizationId: 'org-1',
    });
  }

  it('narrows a whole-project grant down to a single environment', async () => {
    arrangeWholeProjectGrant();
    prisma.environment.findFirst.mockResolvedValue({
      id: 'env-prod',
      name: 'production',
    });
    prisma.grant.update.mockResolvedValue({ id: 'grant-1' });

    await service.update(actor, 'org-1', 'grant-1', {
      environment: 'env-prod',
    });

    const envScopeData: unknown = expect.objectContaining({
      scopeType: 'environment',
      scopeId: 'env-prod',
    });
    expect(prisma.grant.update).toHaveBeenCalledWith({
      where: { id: 'grant-1' },
      data: envScopeData,
    });
    expect(audit.logRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'grant.update',
        environmentId: 'env-prod',
      }),
      expect.anything(), // транзакційний клієнт
    );
  });

  it('widens an environment grant back to the whole project', async () => {
    prisma.grant.findUnique.mockResolvedValue({
      id: 'grant-1',
      identityId: 'id-2',
      projectId: 'proj-1',
      scopeType: 'environment',
      scopeId: 'env-prod',
    });
    prisma.project.findUnique.mockResolvedValue({
      id: 'proj-1',
      organizationId: 'org-1',
    });
    prisma.grant.update.mockResolvedValue({ id: 'grant-1' });

    await service.update(actor, 'org-1', 'grant-1', { environment: '' });

    expect(prisma.environment.findFirst).not.toHaveBeenCalled();
    const projectScopeData: unknown = expect.objectContaining({
      scopeType: 'project',
      scopeId: 'proj-1',
    });
    expect(prisma.grant.update).toHaveBeenCalledWith({
      where: { id: 'grant-1' },
      data: projectScopeData,
    });
  });

  it('leaves the scope untouched when environment is omitted', async () => {
    arrangeWholeProjectGrant();
    prisma.grant.update.mockResolvedValue({ id: 'grant-1' });

    await service.update(actor, 'org-1', 'grant-1', { role: 'reader' });

    const calls = prisma.grant.update.mock.calls as Array<
      [{ data: Record<string, unknown> }]
    >;
    const data = calls[0][0].data;
    expect(data).not.toHaveProperty('scopeType');
    expect(data).not.toHaveProperty('scopeId');
    expect(prisma.environment.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a scope change to an environment outside the grant project', async () => {
    arrangeWholeProjectGrant();
    prisma.environment.findFirst.mockResolvedValue(null);

    await expect(
      service.update(actor, 'org-1', 'grant-1', { environment: 'env-x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.grant.update).not.toHaveBeenCalled();
  });

  it('maps a duplicate scope collision to a conflict', async () => {
    arrangeWholeProjectGrant();
    prisma.environment.findFirst.mockResolvedValue({
      id: 'env-prod',
      name: 'production',
    });
    prisma.grant.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.update(actor, 'org-1', 'grant-1', { environment: 'env-prod' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // --- Fail-closed audit: збій обов'язкового журналу валить grant CRUD (503) ---

  // Required proof #1: a failed audit write rolls back the created grant.
  it('rolls back the created grant when the required audit write fails (transaction-level)', async () => {
    arrangeProjectAndMember();

    let committed = false;
    prisma.$transaction.mockImplementationOnce(
      async (cb: (tx: unknown) => unknown) => {
        const tx = {
          grant: {
            create: jest.fn().mockResolvedValue({
              id: 'grant-1',
              scopeType: 'project',
              scopeId: 'proj-1',
            }),
          },
        };
        const result = await cb(tx); // audit.logRequired кидає тут → коміт нижче недосяжний
        committed = true;
        return result;
      },
    );
    audit.logRequired.mockRejectedValueOnce(
      new ServiceUnavailableException('Audit log unavailable'),
    );

    await expect(
      service.create(actor, 'org-1', {
        identityId: 'id-2',
        projectId: 'proj-1',
        role: 'developer',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    // Колбек кинув до точки коміту → транзакція не закомічена → грант відкочено.
    expect(committed).toBe(false);
  });

  it('update fails with 503 when the required audit write fails', async () => {
    arrangeWholeProjectGrant();
    prisma.grant.update.mockResolvedValue({ id: 'grant-1' });
    audit.logRequired.mockRejectedValueOnce(
      new ServiceUnavailableException('Audit log unavailable'),
    );

    await expect(
      service.update(actor, 'org-1', 'grant-1', { role: 'reader' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('revoke fails with 503 when the required audit write fails', async () => {
    arrangeWholeProjectGrant();
    prisma.grant.delete.mockResolvedValue({ id: 'grant-1' });
    audit.logRequired.mockRejectedValueOnce(
      new ServiceUnavailableException('Audit log unavailable'),
    );

    await expect(
      service.revoke(actor, 'org-1', 'grant-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  // --- H1: org owner/admin зберігає повне керування грантами (включно з
  // аудитованим self-grant reveal як break-glass) ---

  it('lets an org owner/admin revoke a grant and audits it', async () => {
    arrangeWholeProjectGrant();
    prisma.grant.delete.mockResolvedValue({ id: 'grant-1' });

    await expect(service.revoke(actor, 'org-1', 'grant-1')).resolves.toEqual({
      revoked: true,
    });

    expect(authz.assertOrganizationAdmin).toHaveBeenCalledWith(
      'actor-1',
      'org-1',
    );
    expect(prisma.grant.delete).toHaveBeenCalledWith({
      where: { id: 'grant-1' },
    });
    expect(audit.logRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'grant.revoke',
        organizationId: 'org-1',
        projectId: 'proj-1',
      }),
      expect.anything(), // транзакційний клієнт
    );
  });

  it('lets an org owner/admin self-grant reveal as an audited break-glass step', async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: 'proj-1',
      organizationId: 'org-1',
    });
    // Грантуємо собі: актор — людина-член своєї org.
    prisma.identity.findUnique.mockResolvedValue({
      id: actor.id,
      type: 'human',
      serviceOrganizationId: null,
    });
    prisma.organizationMembership.findUnique.mockResolvedValue({
      id: 'mem-self',
    });
    prisma.grant.create.mockResolvedValue({
      id: 'grant-self',
      scopeType: 'project',
      scopeId: 'proj-1',
    });

    await service.create(actor, 'org-1', {
      identityId: actor.id,
      projectId: 'proj-1',
      role: 'reader',
      canRevealSecrets: true,
    });

    const selfRevealData: unknown = expect.objectContaining({
      identityId: 'actor-1',
      canRevealSecrets: true,
    });
    expect(prisma.grant.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: selfRevealData }),
    );
    expect(audit.logRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'grant.create',
        organizationId: 'org-1',
        projectId: 'proj-1',
      }),
      expect.anything(), // транзакційний клієнт
    );
  });
});
