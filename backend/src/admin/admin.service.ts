import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../auth/authorization.service';
import { CacheService } from '../cache/cache.service';
import { AuthPrincipal } from '../auth/auth.types';

interface AuditFilters {
  actions?: string[];
  organizationId?: string;
  projectId?: string;
  environmentId?: string;
  actorId?: string;
  targetType?: string;
  from?: Date;
  to?: Date;
}

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private authz: AuthorizationService,
    private cache: CacheService,
  ) {}

  private applyAuditFilters(
    where: Prisma.AuditLogWhereInput,
    filters?: AuditFilters,
  ): Prisma.AuditLogWhereInput {
    const result: Prisma.AuditLogWhereInput = { ...where };

    if (filters?.actions && filters.actions.length > 0) {
      result.action = { in: filters.actions };
    }
    if (filters?.actorId) result.actorId = filters.actorId;
    if (filters?.targetType) result.targetType = filters.targetType;
    if (filters?.from || filters?.to) {
      result.createdAt = {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      };
    }

    return result;
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

  // --- Organizations (platform metadata, no tenant secrets) ---
  listOrganizations() {
    return this.prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        status: true,
        createdAt: true,
        _count: {
          select: { memberships: true, projects: true, serviceAccounts: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async setOrganizationStatus(
    actorId: string,
    organizationId: string,
    status: 'active' | 'suspended',
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    // Зміна статусу + аудит атомарно: збій журналу відкочує suspend/unsuspend.
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.organization.update({
        where: { id: organizationId },
        data: { status },
      });
      await this.audit.logRequired(
        {
          actorId,
          organizationId,
          action:
            status === 'suspended'
              ? 'organization.suspend'
              : 'organization.unsuspend',
          targetType: 'organization',
          targetId: organizationId,
          metadata: { status },
        },
        tx,
      );
      return result;
    });

    return { id: updated.id, status: updated.status };
  }

  // --- Health ---
  async health() {
    let database = false;
    let cache = false;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = true;
    } catch {
      database = false;
    }

    try {
      const probe = `health:${Date.now()}`;
      await this.cache.set(probe, '1', 5);
      cache = (await this.cache.get<string>(probe)) === '1';
      await this.cache.del(probe);
    } catch {
      cache = false;
    }

    return { status: database ? 'ok' : 'degraded', database, cache };
  }

  // --- Audit ---
  listAuditLog(limit = 100, filters?: AuditFilters) {
    return this.prisma.auditLog.findMany({
      where: this.applyAuditFilters(
        {
          organizationId: filters?.organizationId,
          projectId: filters?.projectId,
          environmentId: filters?.environmentId,
        },
        filters,
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
    filters?: AuditFilters,
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
    const where = this.applyAuditFilters(scopeWhere, filters);

    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
