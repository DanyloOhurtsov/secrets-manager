import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Grant, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../auth/authorization.service';
import { AuthPrincipal } from '../auth/auth.types';
import { CreateGrantDto, UpdateGrantDto } from './dto';

@Injectable()
export class GrantsService {
  constructor(
    private prisma: PrismaService,
    private authz: AuthorizationService,
    private audit: AuditService,
  ) {}

  private normalizeRole(role: string): string {
    return role === 'readonly' ? 'reader' : role;
  }

  // Проєкт має належати саме цій організації — інакше ховаємо існування (404),
  // щоб org-адмін не міг намацати чужі проєкти через свій orgId у шляху.
  private async getProjectInOrg(projectId: string, orgId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project || project.organizationId !== orgId) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }

  // Грант можна видати лише учаснику цієї організації: людині-члену або
  // сервіс-акаунту, закріпленому за org. Це не дає видати доступ "назовні".
  private async assertGranteeInOrg(identityId: string, orgId: string) {
    const identity = await this.prisma.identity.findUnique({
      where: { id: identityId },
    });
    if (!identity) throw new NotFoundException('Identity not found');

    if (identity.type === 'service') {
      if (identity.serviceOrganizationId !== orgId) {
        throw new ForbiddenException(
          'Service account does not belong to this organization',
        );
      }
      return identity;
    }

    const membership = await this.prisma.organizationMembership.findUnique({
      where: {
        organizationId_identityId: { organizationId: orgId, identityId },
      },
    });
    if (!membership) {
      throw new ForbiddenException(
        'Identity is not a member of this organization',
      );
    }
    return identity;
  }

  async create(actor: AuthPrincipal, orgId: string, dto: CreateGrantDto) {
    // Гранти роздає лише org owner/admin. Делеговані грантхолдери (навіть із
    // legacy-прапорцем canManageGrants) керувати доступом не можуть — це закриває
    // self-escalation (H1). Перевіряємо роль ПЕРШОЮ, щоб не зливати існування
    // чужих проєктів тим, хто не є адміном org.
    await this.authz.assertOrganizationAdmin(actor.id, orgId);
    const project = await this.getProjectInOrg(dto.projectId, orgId);
    await this.assertGranteeInOrg(dto.identityId, orgId);

    const env = dto.environment
      ? await this.prisma.environment.findFirst({
          where: {
            projectId: project.id,
            OR: [{ id: dto.environment }, { name: dto.environment }],
          },
        })
      : null;
    if (dto.environment && !env) {
      throw new NotFoundException('Environment not found');
    }

    const role = this.normalizeRole(dto.role);
    const isAdmin = role === 'admin';

    // Створення гранту + обов'язковий аудит — в ОДНІЙ транзакції: якщо запис у
    // журнал падає, грант відкочується (transaction-level fail-closed).
    let grant: Grant;
    try {
      grant = await this.prisma.$transaction(async (tx) => {
        const created = await tx.grant.create({
          data: {
            identityId: dto.identityId,
            projectId: project.id,
            scopeType: env ? 'environment' : 'project',
            scopeId: env?.id ?? project.id,
            role,
            canRevealSecrets: dto.canRevealSecrets ?? isAdmin,
            canCreateSecrets: dto.canCreateSecrets ?? isAdmin,
            canUpdateSecrets: dto.canUpdateSecrets ?? isAdmin,
            canDeleteSecrets: dto.canDeleteSecrets ?? isAdmin,
            canRollbackSecrets: dto.canRollbackSecrets ?? isAdmin,
            // Legacy-колонка: завжди false. Керування грантами/аудитом тепер
            // НЕ залежить від неї (тільки org owner/admin або project-admin роль),
            // тож data-plane грант не може через неї підняти собі привілеї.
            canManageGrants: false,
          },
        });
        await this.audit.logRequired(
          {
            actorId: actor.id,
            organizationId: orgId,
            projectId: project.id,
            environmentId: env?.id ?? null,
            action: 'grant.create',
            targetType: 'grant',
            targetId: created.id,
            metadata: {
              identityId: dto.identityId,
              role,
              scopeType: created.scopeType,
              scopeId: created.scopeId,
            },
          },
          tx,
        );
        return created;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'A grant for this identity and scope already exists — update it instead',
        );
      }
      throw err;
    }

    return grant;
  }

  async list(actor: AuthPrincipal, orgId: string) {
    await this.authz.assertOrganizationAdmin(actor.id, orgId);

    const projects = await this.prisma.project.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true },
    });
    if (projects.length === 0) return [];

    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    const grants = await this.prisma.grant.findMany({
      where: { projectId: { in: projects.map((p) => p.id) } },
      include: {
        identity: {
          select: { id: true, name: true, email: true, type: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const envIds = grants
      .filter((g) => g.scopeType === 'environment')
      .map((g) => g.scopeId);
    const environments = envIds.length
      ? await this.prisma.environment.findMany({
          where: { id: { in: envIds } },
          select: { id: true, name: true },
        })
      : [];
    const envName = new Map(environments.map((e) => [e.id, e.name]));

    return grants.map((g) => ({
      id: g.id,
      identityId: g.identityId,
      identity: g.identity,
      projectId: g.projectId,
      projectName: projectName.get(g.projectId) ?? null,
      scopeType: g.scopeType,
      scopeId: g.scopeId,
      environmentName:
        g.scopeType === 'environment' ? (envName.get(g.scopeId) ?? null) : null,
      role: g.role,
      canRevealSecrets: g.canRevealSecrets,
      canCreateSecrets: g.canCreateSecrets,
      canUpdateSecrets: g.canUpdateSecrets,
      canDeleteSecrets: g.canDeleteSecrets,
      canRollbackSecrets: g.canRollbackSecrets,
      canManageGrants: g.canManageGrants,
      createdAt: g.createdAt,
    }));
  }

  private async loadGrantInOrg(grantId: string, orgId: string) {
    const grant = await this.prisma.grant.findUnique({
      where: { id: grantId },
    });
    if (!grant) throw new NotFoundException('Grant not found');
    // Перевіряємо, що грант справді живе в проєкті цієї org.
    const project = await this.getProjectInOrg(grant.projectId, orgId);
    return { grant, project };
  }

  async update(
    actor: AuthPrincipal,
    orgId: string,
    grantId: string,
    dto: UpdateGrantDto,
  ) {
    // Лише org owner/admin. Перевірка ролі — перед пошуком гранту, щоб не
    // підтверджувати існування гранту неадмінам (H1 / приховування існування).
    await this.authz.assertOrganizationAdmin(actor.id, orgId);
    const { grant, project } = await this.loadGrantInOrg(grantId, orgId);

    const data: Prisma.GrantUpdateInput = {};
    if (dto.role !== undefined) data.role = this.normalizeRole(dto.role);
    if (dto.canRevealSecrets !== undefined)
      data.canRevealSecrets = dto.canRevealSecrets;
    if (dto.canCreateSecrets !== undefined)
      data.canCreateSecrets = dto.canCreateSecrets;
    if (dto.canUpdateSecrets !== undefined)
      data.canUpdateSecrets = dto.canUpdateSecrets;
    if (dto.canDeleteSecrets !== undefined)
      data.canDeleteSecrets = dto.canDeleteSecrets;
    if (dto.canRollbackSecrets !== undefined)
      data.canRollbackSecrets = dto.canRollbackSecrets;
    // canManageGrants свідомо не оновлюється через API (див. dto.ts).

    // Перемикання скоупа в межах того самого проєкту: весь проєкт ↔ оточення.
    // Проєкт лишаємо незмінним — переїзд між проєктами це окрема операція.
    let scopeEnvId: string | null = null;
    if (dto.environment !== undefined) {
      if (dto.environment) {
        const env = await this.prisma.environment.findFirst({
          where: {
            projectId: project.id,
            OR: [{ id: dto.environment }, { name: dto.environment }],
          },
        });
        if (!env) throw new NotFoundException('Environment not found');
        scopeEnvId = env.id;
        data.scopeType = 'environment';
        data.scopeId = env.id;
      } else {
        data.scopeType = 'project';
        data.scopeId = project.id;
      }
    }

    // Оновлення гранту + аудит атомарно: збій журналу відкочує зміну прав.
    let updated: Grant;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.grant.update({ where: { id: grantId }, data });
        await this.audit.logRequired(
          {
            actorId: actor.id,
            organizationId: orgId,
            projectId: project.id,
            environmentId: dto.environment !== undefined ? scopeEnvId : null,
            action: 'grant.update',
            targetType: 'grant',
            targetId: grantId,
            metadata: {
              identityId: grant.identityId,
              changes: data,
            },
          },
          tx,
        );
        return result;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'A grant for this identity and scope already exists — update or revoke that one instead',
        );
      }
      throw err;
    }

    return updated;
  }

  async revoke(actor: AuthPrincipal, orgId: string, grantId: string) {
    // Лише org owner/admin (див. create/update).
    await this.authz.assertOrganizationAdmin(actor.id, orgId);
    const { grant, project } = await this.loadGrantInOrg(grantId, orgId);

    // Видалення гранту + аудит атомарно: збій журналу відкочує відкликання.
    await this.prisma.$transaction(async (tx) => {
      await tx.grant.delete({ where: { id: grantId } });
      await this.audit.logRequired(
        {
          actorId: actor.id,
          organizationId: orgId,
          projectId: project.id,
          action: 'grant.revoke',
          targetType: 'grant',
          targetId: grantId,
          metadata: {
            identityId: grant.identityId,
            scopeType: grant.scopeType,
            scopeId: grant.scopeId,
          },
        },
        tx,
      );
    });

    return { revoked: true };
  }
}
