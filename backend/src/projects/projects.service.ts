import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../auth/auth.types';
import { AuthorizationService } from '../auth/authorization.service';

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private authz: AuthorizationService,
  ) {}

  private async resolveTargetOrganization(
    actor: AuthPrincipal,
    organizationId?: string,
  ) {
    if (actor.type === 'service') {
      throw new ForbiddenException('Service accounts cannot create projects');
    }

    if (organizationId) {
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
      });
      if (!organization) throw new NotFoundException('Organization not found');

      await this.authz.assertOrganizationAdmin(actor.id, organizationId);
      return organization;
    }

    const personalMembership =
      await this.prisma.organizationMembership.findFirst({
        where: {
          identityId: actor.id,
          role: 'owner',
          organization: { type: 'personal' },
        },
        include: { organization: true },
      });

    if (!personalMembership) {
      throw new ForbiddenException('Personal workspace not found');
    }

    return personalMembership.organization;
  }

  async create(actor: AuthPrincipal, name: string, organizationId?: string) {
    const organization = await this.resolveTargetOrganization(
      actor,
      organizationId,
    );

    // Проєкт + admin-grant творцю — атомарно в одній транзакції.
    // Якщо щось упаде, не лишиться "осиротілого" проєкту без доступу.
    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          name,
          organizationId: organization.id,
          createdById: actor.id,
        },
      });
      await tx.grant.create({
        data: {
          identityId: actor.id,
          projectId: created.id,
          scopeType: 'project',
          scopeId: created.id,
          role: 'admin',
          canRevealSecrets: true,
          canCreateSecrets: true,
          canUpdateSecrets: true,
          canDeleteSecrets: true,
          canRollbackSecrets: true,
          canManageGrants: true,
        },
      });
      return created;
    });

    await this.audit.log({
      actorId: actor.id,
      organizationId: organization.id,
      projectId: project.id,
      action: 'project.create',
      targetType: 'project',
      targetId: project.id,
      metadata: { name },
    });

    return project;
  }

  async findAll(actor: AuthPrincipal) {
    const adminMemberships = await this.prisma.organizationMembership.findMany({
      where: {
        identityId: actor.id,
        role: { in: ['owner', 'admin'] },
      },
      select: { organizationId: true },
    });
    const adminOrganizationIds = adminMemberships.map((m) => m.organizationId);
    const adminOrgSet = new Set(adminOrganizationIds);

    const projects = await this.prisma.project.findMany({
      where: {
        OR: [
          { organizationId: { in: adminOrganizationIds } },
          { grants: { some: { identityId: actor.id } } },
        ],
      },
      include: { organization: true, environments: true },
    });

    // У проєктах, де актор НЕ org-admin, показуємо лише оточення, на які він має
    // доступ (грант на весь проєкт = усі оточення; інакше — лише scoped гранти).
    const grants = await this.prisma.grant.findMany({
      where: { identityId: actor.id },
      select: { projectId: true, scopeType: true, scopeId: true },
    });

    return projects.map((p) => {
      if (adminOrgSet.has(p.organizationId)) return p;
      const projectGrants = grants.filter((g) => g.projectId === p.id);
      if (projectGrants.some((g) => g.scopeType === 'project')) return p;
      const envIds = new Set(
        projectGrants
          .filter((g) => g.scopeType === 'environment')
          .map((g) => g.scopeId),
      );
      return {
        ...p,
        environments: p.environments.filter((e) => envIds.has(e.id)),
      };
    });
  }

  async findOne(actor: AuthPrincipal, id: string) {
    const project = await this.authz.getProjectForActor(actor, id);
    const full = await this.prisma.project.findUnique({
      where: { id },
      include: { organization: true, environments: true },
    });
    if (!full) return full;

    // Ховаємо оточення, на які scoped-актор не має гранту.
    const scope = await this.authz.environmentScopeForActor(
      actor,
      id,
      project.organizationId,
    );
    if (scope !== 'all') {
      full.environments = full.environments.filter((e) => scope.has(e.id));
    }
    return full;
  }

  // Дозволи актора на рівні проєкту (без оточення) — щоб UI ховав структурні
  // дії (напр. створення оточення вимагає manageProject на рівні проєкту).
  async capabilities(actor: AuthPrincipal, id: string) {
    return this.authz.resolveCapabilities(actor, id);
  }

  async transfer(
    actor: AuthPrincipal,
    projectId: string,
    targetOrganizationId: string,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.organizationId === targetOrganizationId) {
      throw new BadRequestException(
        'Project already belongs to this organization',
      );
    }

    // Actor має бути owner/admin і в джерелі, і в цільовій org.
    await this.authz.assertOrganizationAdmin(actor.id, project.organizationId);
    const target = await this.prisma.organization.findUnique({
      where: { id: targetOrganizationId },
    });
    if (!target) throw new NotFoundException('Target organization not found');
    await this.authz.assertOrganizationAdmin(actor.id, targetOrganizationId);

    const collision = await this.prisma.project.findUnique({
      where: {
        organizationId_name: {
          organizationId: targetOrganizationId,
          name: project.name,
        },
      },
    });
    if (collision) {
      throw new ConflictException(
        'A project with this name already exists in the target organization',
      );
    }

    // Переносимо проєкт і відкликаємо гранти тих, хто не належить цільовій org.
    const { revoked } = await this.prisma.$transaction(async (tx) => {
      const grants = await tx.grant.findMany({ where: { projectId } });
      const identityIds = [...new Set(grants.map((g) => g.identityId))];

      const members = await tx.organizationMembership.findMany({
        where: {
          organizationId: targetOrganizationId,
          identityId: { in: identityIds },
        },
        select: { identityId: true },
      });
      const memberSet = new Set(members.map((m) => m.identityId));

      const identities = await tx.identity.findMany({
        where: { id: { in: identityIds } },
        select: { id: true, type: true, serviceOrganizationId: true },
      });
      const identityById = new Map(identities.map((i) => [i.id, i]));

      const toRevoke = grants
        .filter((g) => {
          const identity = identityById.get(g.identityId);
          if (!identity) return true;
          if (identity.type === 'service') {
            return identity.serviceOrganizationId !== targetOrganizationId;
          }
          return !memberSet.has(g.identityId);
        })
        .map((g) => g.id);

      if (toRevoke.length > 0) {
        await tx.grant.deleteMany({ where: { id: { in: toRevoke } } });
      }
      await tx.project.update({
        where: { id: projectId },
        data: { organizationId: targetOrganizationId },
      });

      return { revoked: toRevoke.length };
    });

    await this.audit.log({
      actorId: actor.id,
      organizationId: targetOrganizationId,
      projectId,
      action: 'project.transfer',
      targetType: 'project',
      targetId: projectId,
      metadata: {
        fromOrganizationId: project.organizationId,
        toOrganizationId: targetOrganizationId,
        revokedGrants: revoked,
      },
    });

    return { transferred: true, revokedGrants: revoked };
  }

  async remove(actor: AuthPrincipal, id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    await this.authz.checkProjectAccess(actor, id, 'manageProject');

    await this.audit.log({
      actorId: actor.id,
      organizationId: project.organizationId,
      projectId: id,
      action: 'project.delete',
      targetType: 'project',
      targetId: id,
      metadata: { name: project.name },
    });

    return this.prisma.project.delete({ where: { id } });
  }
}
