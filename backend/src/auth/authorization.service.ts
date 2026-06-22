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

const ORG_ADMIN_ROLES = new Set(['owner', 'admin']);

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
    if (permission === 'manageGrants' || permission === 'manageProject') {
      return grant.canManageGrants;
    }
    return false;
  }

  async hasOrganizationAdminRole(
    identityId: string,
    organizationId: string,
  ): Promise<boolean> {
    const membership = await this.prisma.organizationMembership.findUnique({
      where: {
        organizationId_identityId: { organizationId, identityId },
      },
      select: { role: true },
    });

    return !!membership && ORG_ADMIN_ROLES.has(membership.role);
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

  async getProjectForActor(actor: AuthPrincipal, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { organization: true },
    });
    if (!project) throw new NotFoundException('Project not found');

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

  async checkProjectAccess(
    actor: AuthPrincipal,
    projectId: string,
    permission: ProjectPermission,
    environmentId?: string,
  ): Promise<void> {
    const project = await this.getProjectForActor(actor, projectId);

    const isOrgAdmin = await this.hasOrganizationAdminRole(
      actor.id,
      project.organizationId,
    );
    if (isOrgAdmin) return;

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

    if (grants.length === 0) {
      throw new ForbiddenException('No access to this project');
    }

    const hasPermission = grants.some((grant) =>
      this.grantAllows(grant, permission),
    );

    if (!hasPermission) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
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
