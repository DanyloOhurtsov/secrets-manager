import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { TokenService } from '../auth/token.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../auth/authorization.service';
import { AuthPrincipal } from '../auth/auth.types';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private tokenService: TokenService,
    private audit: AuditService,
    private authz: AuthorizationService,
  ) {}

  private withAuditActionFilter(
    where: Prisma.AuditLogWhereInput,
    actions?: string[],
  ): Prisma.AuditLogWhereInput {
    if (!actions || actions.length === 0) return where;

    return {
      ...where,
      action: { in: actions },
    };
  }

  private async buildAuditScopeWhereForActor(
    actor: AuthPrincipal,
    filters?: {
      organizationId?: string;
      projectId?: string;
      environmentId?: string;
    },
  ): Promise<Prisma.AuditLogWhereInput> {
    if (actor.isSuperadmin) {
      return {
        organizationId: filters?.organizationId,
        projectId: filters?.projectId,
        environmentId: filters?.environmentId,
      };
    }

    if (filters?.environmentId) {
      const environment = await this.prisma.environment.findUnique({
        where: { id: filters.environmentId },
        select: { id: true, projectId: true },
      });
      if (!environment) throw new NotFoundException('Environment not found');
      await this.authz.checkProjectAccess(
        actor,
        environment.projectId,
        'manageProject',
        environment.id,
      );

      return {
        environmentId: environment.id,
        projectId: environment.projectId,
      };
    }

    if (filters?.projectId) {
      await this.authz.checkProjectAccess(
        actor,
        filters.projectId,
        'manageProject',
      );

      return { projectId: filters.projectId };
    }

    if (filters?.organizationId) {
      await this.authz.assertOrganizationAdmin(
        actor.id,
        filters.organizationId,
      );

      return { organizationId: filters.organizationId };
    }

    const adminMemberships = await this.prisma.organizationMembership.findMany({
      where: {
        identityId: actor.id,
        role: { in: ['owner', 'admin'] },
      },
      select: { organizationId: true },
    });
    const adminGrants = await this.prisma.grant.findMany({
      where: {
        identityId: actor.id,
        OR: [{ role: 'admin' }, { canManageGrants: true }],
      },
      select: { projectId: true },
    });

    const organizationIds = adminMemberships.map((m) => m.organizationId);
    const projectIds = [...new Set(adminGrants.map((g) => g.projectId))];

    if (organizationIds.length === 0 && projectIds.length === 0) {
      throw new ForbiddenException('Audit access required');
    }

    return {
      OR: [
        ...(organizationIds.length > 0
          ? [{ organizationId: { in: organizationIds } }]
          : []),
        ...(projectIds.length > 0 ? [{ projectId: { in: projectIds } }] : []),
      ],
    };
  }

  // --- Identity ---
  async createIdentity(actorId: string, name: string, type: string) {
    const identity = await this.prisma.identity.create({
      data: { name, type },
      select: {
        id: true,
        name: true,
        email: true,
        type: true,
        isSuperadmin: true,
        serviceOrganizationId: true,
        createdAt: true,
      },
    });

    await this.audit.log({
      actorId,
      action: 'identity.create',
      targetType: 'identity',
      targetId: identity.id,
      metadata: { name, type },
    });

    return identity;
  }

  listIdentities() {
    return this.prisma.identity.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        type: true,
        isSuperadmin: true,
        serviceOrganizationId: true,
        createdAt: true,
      },
    });
  }

  // --- Tokens ---
  async issueToken(actorId: string, identityId: string, label?: string) {
    const identity = await this.prisma.identity.findUnique({
      where: { id: identityId },
    });
    if (!identity) throw new NotFoundException('Identity not found');

    const token = await this.tokenService.issue(identityId, label);

    await this.audit.log({
      actorId,
      action: 'token.issue',
      targetType: 'identity',
      targetId: identityId,
      metadata: { label: label ?? null },
    });

    // повертаємо сам токен — показуємо один раз (у лог НЕ пишемо)
    return { token };
  }

  async revokeToken(actorId: string, tokenId: string) {
    const token = await this.prisma.token.findUnique({
      where: { id: tokenId },
    });
    if (!token) throw new NotFoundException('Token not found');
    await this.tokenService.revoke(tokenId);

    await this.audit.log({
      actorId,
      action: 'token.revoke',
      targetType: 'token',
      targetId: tokenId,
      metadata: { identityId: token.identityId },
    });

    return { revoked: true };
  }

  listTokens(identityId: string) {
    return this.prisma.token.findMany({
      where: { identityId },
      select: {
        id: true,
        label: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
  }

  // --- Grants ---
  async createGrant(
    actorId: string,
    identityId: string,
    projectId: string,
    role: string,
    environment?: string,
    capabilities?: {
      canRevealSecrets?: boolean;
      canCreateSecrets?: boolean;
      canUpdateSecrets?: boolean;
      canDeleteSecrets?: boolean;
      canRollbackSecrets?: boolean;
      canManageGrants?: boolean;
    },
  ) {
    const identity = await this.prisma.identity.findUnique({
      where: { id: identityId },
    });
    if (!identity) throw new NotFoundException('Identity not found');

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');

    const env = environment
      ? await this.prisma.environment.findFirst({
          where: {
            projectId,
            OR: [{ id: environment }, { name: environment }],
          },
        })
      : null;

    if (environment && !env)
      throw new NotFoundException('Environment not found');

    const normalizedRole = role === 'readonly' ? 'reader' : role;
    const isAdmin = normalizedRole === 'admin';

    const grant = await this.prisma.grant.create({
      data: {
        identityId,
        projectId,
        scopeType: env ? 'environment' : 'project',
        scopeId: env?.id ?? projectId,
        role: normalizedRole,
        canRevealSecrets: capabilities?.canRevealSecrets ?? isAdmin,
        canCreateSecrets: capabilities?.canCreateSecrets ?? isAdmin,
        canUpdateSecrets: capabilities?.canUpdateSecrets ?? isAdmin,
        canDeleteSecrets: capabilities?.canDeleteSecrets ?? isAdmin,
        canRollbackSecrets: capabilities?.canRollbackSecrets ?? isAdmin,
        canManageGrants: capabilities?.canManageGrants ?? isAdmin,
      },
    });

    await this.audit.log({
      actorId,
      organizationId: project.organizationId,
      projectId,
      environmentId: env?.id ?? null,
      action: 'grant.create',
      targetType: 'grant',
      targetId: grant.id,
      metadata: {
        identityId,
        projectId,
        role: normalizedRole,
        scopeType: grant.scopeType,
        scopeId: grant.scopeId,
      },
    });

    return grant;
  }

  async revokeGrant(actorId: string, grantId: string) {
    const grant = await this.prisma.grant.findUnique({
      where: { id: grantId },
    });
    if (!grant) throw new NotFoundException('Grant not found');
    await this.prisma.grant.delete({ where: { id: grantId } });

    await this.audit.log({
      actorId,
      action: 'grant.revoke',
      targetType: 'grant',
      targetId: grantId,
      projectId: grant.projectId,
      metadata: {
        identityId: grant.identityId,
        projectId: grant.projectId,
        scopeType: grant.scopeType,
        scopeId: grant.scopeId,
      },
    });

    return { revoked: true };
  }

  listGrants(identityId: string) {
    return this.prisma.grant.findMany({ where: { identityId } });
  }

  // --- Audit ---
  listAuditLog(
    limit = 100,
    filters?: {
      actions?: string[];
      organizationId?: string;
      projectId?: string;
      environmentId?: string;
    },
  ) {
    return this.prisma.auditLog.findMany({
      where: this.withAuditActionFilter(
        {
          organizationId: filters?.organizationId,
          projectId: filters?.projectId,
          environmentId: filters?.environmentId,
        },
        filters?.actions,
      ),
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  listAuditActions(filters?: {
    organizationId?: string;
    projectId?: string;
    environmentId?: string;
  }) {
    return this.prisma.auditLog
      .findMany({
        where: {
          organizationId: filters?.organizationId,
          projectId: filters?.projectId,
          environmentId: filters?.environmentId,
        },
        select: { action: true },
        distinct: ['action'],
        orderBy: { action: 'asc' },
      })
      .then((rows) => rows.map((row) => row.action));
  }

  async listAuditActionsForActor(
    actor: AuthPrincipal,
    filters?: {
      organizationId?: string;
      projectId?: string;
      environmentId?: string;
    },
  ) {
    const where = await this.buildAuditScopeWhereForActor(actor, filters);
    const rows = await this.prisma.auditLog.findMany({
      where,
      select: { action: true },
      distinct: ['action'],
      orderBy: { action: 'asc' },
    });

    return rows.map((row) => row.action);
  }

  async listAuditForActor(
    actor: AuthPrincipal,
    filters?: {
      actions?: string[];
      organizationId?: string;
      projectId?: string;
      environmentId?: string;
    },
    limit = 100,
  ) {
    if (actor.isSuperadmin) {
      return this.listAuditLog(limit, filters);
    }

    const scopeWhere = await this.buildAuditScopeWhereForActor(actor, {
      organizationId: filters?.organizationId,
      projectId: filters?.projectId,
      environmentId: filters?.environmentId,
    });
    const where = this.withAuditActionFilter(scopeWhere, filters?.actions);

    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
