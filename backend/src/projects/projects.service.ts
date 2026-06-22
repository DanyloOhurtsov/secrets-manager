import {
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

    return this.prisma.project.findMany({
      where: {
        OR: [
          { organizationId: { in: adminOrganizationIds } },
          { grants: { some: { identityId: actor.id } } },
        ],
      },
      include: { organization: true, environments: true },
    });
  }

  async findOne(actor: AuthPrincipal, id: string) {
    await this.authz.getProjectForActor(actor, id);
    return this.prisma.project.findUnique({
      where: { id },
      include: { organization: true, environments: true },
    });
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
