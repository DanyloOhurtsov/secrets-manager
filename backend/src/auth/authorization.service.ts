import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthPrincipal } from './auth.types';

export type Role = 'viewer' | 'reader' | 'developer' | 'admin' | 'readonly';
export type ProjectPermission =
  | 'listSecrets'
  | 'revealSecrets'
  | 'createSecrets'
  | 'updateSecrets'
  | 'deleteSecrets'
  | 'rollbackSecrets'
  | 'manageGrants'
  | 'manageProject';

// Повна мапа дозволів актора в межах одного scope — для UI, який ховає кнопки
// дій, що користувачу недоступні (на бекенді кожна дія все одно перевіряється
// окремо через checkProjectAccess — це лише підказка інтерфейсу).
export type ProjectCapabilities = Record<ProjectPermission, boolean>;

const ORG_ADMIN_ROLES = new Set(['owner', 'admin']);

// Дозволи, які org owner/admin мають за самою роллю (без гранту): керування
// структурою проєкту, грантами та перегляд метаданих (список ключів секретів).
// Доступ до ЗНАЧЕНЬ секретів (reveal/create/update/delete/rollback) навмисно
// сюди НЕ входить — навіть owner отримує його лише через явний грант:
// "ownership alone should not imply universal secret reveal".
const ORG_ADMIN_PERMISSIONS = new Set<ProjectPermission>([
  'listSecrets',
  'manageGrants',
  'manageProject',
]);

@Injectable()
export class AuthorizationService {
  constructor(private prisma: PrismaService) {}

  private grantAllows(
    grant: {
      role: string;
      canRevealSecrets: boolean;
      canCreateSecrets: boolean;
      canUpdateSecrets: boolean;
      canDeleteSecrets: boolean;
      canRollbackSecrets: boolean;
      canManageGrants: boolean;
    },
    permission: ProjectPermission,
  ): boolean {
    // Керування грантами — площина УПРАВЛІННЯ (org owner/admin), а не даних.
    // Жоден data-plane грант не дає manageGrants — навіть admin-роль чи застарілий
    // прапорець canManageGrants. Це закриває self-escalation: делегат не може
    // дописати собі reveal/admin. Сам grant CRUD гейтиться роллю org owner/admin
    // у GrantsService (assertOrganizationAdmin), а не через цю перевірку.
    if (permission === 'manageGrants') return false;

    if (grant.role === 'admin') return true;
    if (permission === 'listSecrets') return true;
    if (permission === 'revealSecrets') {
      return (
        grant.role === 'reader' ||
        grant.role === 'readonly' ||
        grant.canRevealSecrets
      );
    }
    if (permission === 'createSecrets') return grant.canCreateSecrets;
    if (permission === 'updateSecrets') return grant.canUpdateSecrets;
    if (permission === 'deleteSecrets') return grant.canDeleteSecrets;
    if (permission === 'rollbackSecrets') return grant.canRollbackSecrets;
    // manageProject (CRUD оточень, видалення проєкту) — лише project-admin грант
    // (вище через role === 'admin') або org owner/admin (ORG_ADMIN_PERMISSIONS).
    // canManageGrants сюди НАВМИСНО не входить: керування доступом != керування
    // структурою проєкту.
    return false;
  }

  async getOrganizationRole(
    identityId: string,
    organizationId: string,
  ): Promise<string | null> {
    const membership = await this.prisma.organizationMembership.findUnique({
      where: {
        organizationId_identityId: { organizationId, identityId },
      },
      select: { role: true },
    });

    return membership?.role ?? null;
  }

  async hasOrganizationAdminRole(
    identityId: string,
    organizationId: string,
  ): Promise<boolean> {
    const role = await this.getOrganizationRole(identityId, organizationId);
    return !!role && ORG_ADMIN_ROLES.has(role);
  }

  async assertOrganizationAdmin(
    identityId: string,
    organizationId: string,
  ): Promise<void> {
    const allowed = await this.hasOrganizationAdminRole(
      identityId,
      organizationId,
    );
    if (!allowed)
      throw new ForbiddenException('Organization admin access required');
  }

  async assertOrganizationMember(
    identityId: string,
    organizationId: string,
  ): Promise<string> {
    const role = await this.getOrganizationRole(identityId, organizationId);
    if (!role)
      throw new ForbiddenException('Not a member of this organization');
    return role;
  }

  async assertOrganizationOwner(
    identityId: string,
    organizationId: string,
  ): Promise<void> {
    const role = await this.getOrganizationRole(identityId, organizationId);
    if (role !== 'owner')
      throw new ForbiddenException('Organization owner access required');
  }

  async getProjectForActor(actor: AuthPrincipal, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { organization: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    // Призупинена організація заморожує доступ до всіх своїх ресурсів —
    // навіть для власних owner/admin. Розморожування — лише через platform admin.
    if (project.organization.status !== 'active') {
      throw new ForbiddenException('Organization is suspended');
    }

    const membership = await this.prisma.organizationMembership.findUnique({
      where: {
        organizationId_identityId: {
          organizationId: project.organizationId,
          identityId: actor.id,
        },
      },
      select: { role: true },
    });
    if (membership && ORG_ADMIN_ROLES.has(membership.role)) return project;

    if (
      actor.type === 'service' &&
      actor.serviceOrganizationId !== project.organizationId
    ) {
      throw new NotFoundException('Project not found');
    }

    const grant = await this.prisma.grant.findFirst({
      where: {
        identityId: actor.id,
        projectId,
      },
      select: { id: true },
    });
    if (grant) return project;

    throw new NotFoundException('Project not found');
  }

  // Які оточення проєкту бачить актор: 'all' (org owner/admin або грант на весь
  // проєкт) чи лише конкретні (коли в актора самі environment-scoped гранти).
  // Викликати ПІСЛЯ getProjectForActor — сам доступ до проєкту тут не перевіряємо.
  async environmentScopeForActor(
    actor: AuthPrincipal,
    projectId: string,
    organizationId: string,
  ): Promise<'all' | Set<string>> {
    const isOrgAdmin = await this.hasOrganizationAdminRole(
      actor.id,
      organizationId,
    );
    if (isOrgAdmin) return 'all';

    const grants = await this.prisma.grant.findMany({
      where: { identityId: actor.id, projectId },
      select: { scopeType: true, scopeId: true },
    });
    // Грант на весь проєкт покриває всі його оточення.
    if (grants.some((g) => g.scopeType === 'project')) return 'all';
    return new Set(
      grants.filter((g) => g.scopeType === 'environment').map((g) => g.scopeId),
    );
  }

  async checkProjectAccess(
    actor: AuthPrincipal,
    projectId: string,
    permission: ProjectPermission,
    environmentId?: string,
  ): Promise<void> {
    const project = await this.getProjectForActor(actor, projectId);

    // Org owner/admin керують структурою за роллю, але для доступу до значень
    // секретів проходять ту саму перевірку грантів, що й усі інші.
    const isOrgAdmin = await this.hasOrganizationAdminRole(
      actor.id,
      project.organizationId,
    );
    if (isOrgAdmin && ORG_ADMIN_PERMISSIONS.has(permission)) return;

    const scopeFilters = [
      { scopeType: 'project', scopeId: projectId },
      ...(environmentId
        ? [{ scopeType: 'environment', scopeId: environmentId }]
        : []),
    ];

    const grants = await this.prisma.grant.findMany({
      where: {
        identityId: actor.id,
        projectId,
        OR: scopeFilters,
      },
    });

    // Сюди доходять або org-admin (для секретних дій), або актор із грантом на
    // проєкт (getProjectForActor уже відсіяв тих, хто не бачить проєкт зовсім).
    const hasPermission = grants.some((grant) =>
      this.grantAllows(grant, permission),
    );

    if (!hasPermission) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
  }

  // Обчислює ВСІ дозволи актора в межах project/environment за один прохід.
  // Та сама логіка, що й checkProjectAccess (grantAllows + org-admin bypass для
  // структурних дій), але повертає булеву мапу замість того, щоб кидати помилку.
  async resolveCapabilities(
    actor: AuthPrincipal,
    projectId: string,
    environmentId?: string,
  ): Promise<ProjectCapabilities> {
    // Кидає NotFound, якщо актор узагалі не бачить проєкт — ховаємо існування.
    const project = await this.getProjectForActor(actor, projectId);

    const isOrgAdmin = await this.hasOrganizationAdminRole(
      actor.id,
      project.organizationId,
    );

    const scopeFilters = [
      { scopeType: 'project', scopeId: projectId },
      ...(environmentId
        ? [{ scopeType: 'environment', scopeId: environmentId }]
        : []),
    ];

    const grants = await this.prisma.grant.findMany({
      where: { identityId: actor.id, projectId, OR: scopeFilters },
    });

    const can = (permission: ProjectPermission): boolean =>
      (isOrgAdmin && ORG_ADMIN_PERMISSIONS.has(permission)) ||
      grants.some((grant) => this.grantAllows(grant, permission));

    return {
      listSecrets: can('listSecrets'),
      revealSecrets: can('revealSecrets'),
      createSecrets: can('createSecrets'),
      updateSecrets: can('updateSecrets'),
      deleteSecrets: can('deleteSecrets'),
      rollbackSecrets: can('rollbackSecrets'),
      manageGrants: can('manageGrants'),
      manageProject: can('manageProject'),
    };
  }

  async canAccessProject(
    actor: AuthPrincipal,
    projectId: string,
    permission: ProjectPermission,
    environmentId?: string,
  ): Promise<boolean> {
    try {
      await this.checkProjectAccess(
        actor,
        projectId,
        permission,
        environmentId,
      );
      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) return false;
      throw err;
    }
  }
}
