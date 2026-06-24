import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  AuthorizationService,
  ProjectPermission,
} from './authorization.service';
import { PrismaService } from '../prisma.service';
import { AuthPrincipal } from './auth.types';

// Базовий людський актор без жодних особливих прав — права додаємо в кожному тесті.
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

// Грант з усіма capability=false за замовчуванням (як developer/viewer).
function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant-1',
    identityId: 'actor-1',
    projectId: 'proj-1',
    scopeType: 'project',
    scopeId: 'proj-1',
    role: 'developer',
    canRevealSecrets: false,
    canCreateSecrets: false,
    canUpdateSecrets: false,
    canDeleteSecrets: false,
    canRollbackSecrets: false,
    canManageGrants: false,
    ...overrides,
  };
}

describe('AuthorizationService', () => {
  let service: AuthorizationService;
  let prisma: {
    project: { findUnique: jest.Mock };
    organizationMembership: { findUnique: jest.Mock; findMany: jest.Mock };
    grant: { findFirst: jest.Mock; findMany: jest.Mock };
  };

  const activeProject = {
    id: 'proj-1',
    organizationId: 'org-1',
    organization: { id: 'org-1', status: 'active' },
  };

  beforeEach(async () => {
    prisma = {
      project: { findUnique: jest.fn().mockResolvedValue(activeProject) },
      organizationMembership: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      grant: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AuthorizationService>(AuthorizationService);
  });

  // --- Найважливіший інваріант: platform admin НЕ читає чужі секрети ---
  describe('platform admin boundary', () => {
    it('superadmin without a grant is denied tenant project access (and existence is hidden)', async () => {
      // Жодного членства, жодного гранту — лише isSuperadmin.
      await expect(
        service.checkProjectAccess(
          human({ isSuperadmin: true }),
          'proj-1',
          'revealSecrets',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      // Дуже важливо: isSuperadmin не дає жодного автоматичного гранту.
      expect(prisma.grant.findMany).not.toHaveBeenCalled();
    });

    it('superadmin gets access ONLY through an explicit tenant grant (break-glass)', async () => {
      const actor = human({ isSuperadmin: true });
      prisma.grant.findFirst.mockResolvedValue(grant({ role: 'reader' }));
      prisma.grant.findMany.mockResolvedValue([grant({ role: 'reader' })]);

      await expect(
        service.checkProjectAccess(actor, 'proj-1', 'revealSecrets'),
      ).resolves.toBeUndefined();
    });
  });

  // --- Org ролі: owner/admin керують структурою, але не значеннями секретів ---
  describe('organization roles', () => {
    it('org owner manages structure (projects/grants/metadata) without a grant', async () => {
      prisma.organizationMembership.findUnique.mockResolvedValue({
        role: 'owner',
      });

      await expect(
        service.checkProjectAccess(human(), 'proj-1', 'manageProject'),
      ).resolves.toBeUndefined();
      await expect(
        service.checkProjectAccess(human(), 'proj-1', 'manageGrants'),
      ).resolves.toBeUndefined();
      await expect(
        service.checkProjectAccess(human(), 'proj-1', 'listSecrets'),
      ).resolves.toBeUndefined();
      // Жодна з цих дій не потребує гранту — все вирішує роль.
      expect(prisma.grant.findMany).not.toHaveBeenCalled();
    });

    it('org owner CANNOT reveal/modify secret values without an explicit grant', async () => {
      prisma.organizationMembership.findUnique.mockResolvedValue({
        role: 'owner',
      });
      // grant.findMany → [] за замовчуванням: жодного гранту на значення.
      for (const perm of [
        'revealSecrets',
        'createSecrets',
        'updateSecrets',
        'deleteSecrets',
        'rollbackSecrets',
      ] as const) {
        await expect(
          service.checkProjectAccess(human(), 'proj-1', perm),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
      // Перевірка таки звертається до грантів — bypass не спрацьовує.
      expect(prisma.grant.findMany).toHaveBeenCalled();
    });

    it('org admin gains secret-value access only through an explicit grant', async () => {
      prisma.organizationMembership.findUnique.mockResolvedValue({
        role: 'admin',
      });
      prisma.grant.findMany.mockResolvedValue([grant({ role: 'reader' })]);

      await expect(
        service.checkProjectAccess(human(), 'proj-1', 'revealSecrets'),
      ).resolves.toBeUndefined();
    });

    it('plain org member with no grant is denied', async () => {
      prisma.organizationMembership.findUnique.mockResolvedValue({
        role: 'member',
      });
      // grant.findFirst у getProjectForActor → null ⇒ проєкт "не знайдено".
      await expect(
        service.checkProjectAccess(human(), 'proj-1', 'listSecrets'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // --- Ізоляція service account: лише власна org ---
  describe('service account isolation', () => {
    it('service account cannot reach a project outside its own organization', async () => {
      const actor = human({
        id: 'svc-1',
        type: 'service',
        serviceOrganizationId: 'org-other',
      });
      // Має грант, але це не врятує — org не збігається.
      prisma.grant.findFirst.mockResolvedValue(grant({ identityId: 'svc-1' }));

      await expect(
        service.checkProjectAccess(actor, 'proj-1', 'listSecrets'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('service account in its own organization with a grant is allowed', async () => {
      const actor = human({
        id: 'svc-1',
        type: 'service',
        serviceOrganizationId: 'org-1',
      });
      prisma.grant.findFirst.mockResolvedValue(
        grant({ identityId: 'svc-1', role: 'reader' }),
      );
      prisma.grant.findMany.mockResolvedValue([
        grant({ identityId: 'svc-1', role: 'reader' }),
      ]);

      await expect(
        service.checkProjectAccess(actor, 'proj-1', 'revealSecrets'),
      ).resolves.toBeUndefined();
    });
  });

  // --- Capability-мапа грантів (актор — звичайний org member з грантом) ---
  describe('grant capability mapping', () => {
    beforeEach(() => {
      prisma.organizationMembership.findUnique.mockResolvedValue({
        role: 'member',
      });
    });

    function withGrant(g: Record<string, unknown>) {
      prisma.grant.findFirst.mockResolvedValue(g);
      prisma.grant.findMany.mockResolvedValue([g]);
    }

    async function allows(perm: ProjectPermission) {
      return service.canAccessProject(human(), 'proj-1', perm, 'env-1');
    }

    it('viewer can list but cannot reveal/create/update/delete', async () => {
      withGrant(grant({ role: 'viewer' }));
      await expect(allows('listSecrets')).resolves.toBe(true);
      await expect(allows('revealSecrets')).resolves.toBe(false);
      await expect(allows('createSecrets')).resolves.toBe(false);
      await expect(allows('updateSecrets')).resolves.toBe(false);
      await expect(allows('deleteSecrets')).resolves.toBe(false);
    });

    it('reader can reveal but cannot modify', async () => {
      withGrant(grant({ role: 'reader' }));
      await expect(allows('revealSecrets')).resolves.toBe(true);
      await expect(allows('updateSecrets')).resolves.toBe(false);
      await expect(allows('deleteSecrets')).resolves.toBe(false);
    });

    it('developer with default caps can list only — no reveal/create/update', async () => {
      withGrant(grant({ role: 'developer' }));
      await expect(allows('listSecrets')).resolves.toBe(true);
      await expect(allows('revealSecrets')).resolves.toBe(false);
      await expect(allows('createSecrets')).resolves.toBe(false);
      await expect(allows('updateSecrets')).resolves.toBe(false);
      await expect(allows('rollbackSecrets')).resolves.toBe(false);
      await expect(allows('manageGrants')).resolves.toBe(false);
    });

    it('explicit capability flags grant the matching permission', async () => {
      withGrant(grant({ role: 'developer', canUpdateSecrets: true }));
      await expect(allows('updateSecrets')).resolves.toBe(true);
      await expect(allows('createSecrets')).resolves.toBe(false);
    });

    it('project admin grant allows every data/structure permission but NOT grant management', async () => {
      withGrant(grant({ role: 'admin' }));
      await expect(allows('revealSecrets')).resolves.toBe(true);
      await expect(allows('createSecrets')).resolves.toBe(true);
      await expect(allows('deleteSecrets')).resolves.toBe(true);
      await expect(allows('rollbackSecrets')).resolves.toBe(true);
      await expect(allows('manageProject')).resolves.toBe(true);
      // Керування грантами — лише org owner/admin (роль org), а не data-plane
      // грант. Навіть project-admin грант не дає manageGrants (H1).
      await expect(allows('manageGrants')).resolves.toBe(false);
    });

    it('canManageGrants (legacy flag) grants neither manageGrants nor manageProject', async () => {
      // Делегат із застарілим прапорцем canManageGrants на developer-гранті НЕ
      // може ні керувати грантами, ні керувати структурою проєкту (видаляти
      // проєкт/оточення), ні — поготів — читати значення секретів.
      withGrant(grant({ role: 'developer', canManageGrants: true }));
      await expect(allows('manageGrants')).resolves.toBe(false);
      await expect(allows('manageProject')).resolves.toBe(false);
      await expect(allows('revealSecrets')).resolves.toBe(false);
      await expect(allows('deleteSecrets')).resolves.toBe(false);
    });

    // resolveCapabilities (read-path для UI) має збігатися з checkProjectAccess.
    it('resolveCapabilities reflects developer default — list only', async () => {
      withGrant(grant({ role: 'developer' }));
      const caps = await service.resolveCapabilities(
        human(),
        'proj-1',
        'env-1',
      );
      expect(caps).toEqual({
        listSecrets: true,
        revealSecrets: false,
        createSecrets: false,
        updateSecrets: false,
        deleteSecrets: false,
        rollbackSecrets: false,
        manageGrants: false,
        manageProject: false,
      });
    });

    it('resolveCapabilities surfaces explicitly granted capabilities', async () => {
      withGrant(grant({ role: 'developer', canUpdateSecrets: true }));
      const caps = await service.resolveCapabilities(
        human(),
        'proj-1',
        'env-1',
      );
      expect(caps.updateSecrets).toBe(true);
      expect(caps.deleteSecrets).toBe(false);
      expect(caps.rollbackSecrets).toBe(false);
    });
  });

  // --- Які оточення бачить актор (для фільтрації списків в UI) ---
  describe('environmentScopeForActor', () => {
    it('org admin sees all environments (no grant lookup)', async () => {
      prisma.organizationMembership.findUnique.mockResolvedValue({
        role: 'admin',
      });
      await expect(
        service.environmentScopeForActor(human(), 'proj-1', 'org-1'),
      ).resolves.toBe('all');
      expect(prisma.grant.findMany).not.toHaveBeenCalled();
    });

    it('a project-scoped grant sees all environments', async () => {
      prisma.organizationMembership.findUnique.mockResolvedValue({
        role: 'member',
      });
      prisma.grant.findMany.mockResolvedValue([
        { scopeType: 'project', scopeId: 'proj-1' },
      ]);
      await expect(
        service.environmentScopeForActor(human(), 'proj-1', 'org-1'),
      ).resolves.toBe('all');
    });

    it('environment-scoped grants limit visibility to those environments', async () => {
      prisma.organizationMembership.findUnique.mockResolvedValue({
        role: 'member',
      });
      prisma.grant.findMany.mockResolvedValue([
        { scopeType: 'environment', scopeId: 'env-prod' },
        { scopeType: 'environment', scopeId: 'env-staging' },
      ]);
      await expect(
        service.environmentScopeForActor(human(), 'proj-1', 'org-1'),
      ).resolves.toEqual(new Set(['env-prod', 'env-staging']));
    });

    it('a project-scoped grant alongside env grants still sees all', async () => {
      prisma.organizationMembership.findUnique.mockResolvedValue({
        role: 'member',
      });
      prisma.grant.findMany.mockResolvedValue([
        { scopeType: 'environment', scopeId: 'env-prod' },
        { scopeType: 'project', scopeId: 'proj-1' },
      ]);
      await expect(
        service.environmentScopeForActor(human(), 'proj-1', 'org-1'),
      ).resolves.toBe('all');
    });
  });

  // --- Призупинена організація замикає весь доступ ---
  describe('suspended organization', () => {
    it('freezes access even for the org owner', async () => {
      prisma.project.findUnique.mockResolvedValue({
        ...activeProject,
        organization: { id: 'org-1', status: 'suspended' },
      });
      prisma.organizationMembership.findUnique.mockResolvedValue({
        role: 'owner',
      });

      await expect(
        service.checkProjectAccess(human(), 'proj-1', 'listSecrets'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
