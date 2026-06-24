import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../auth/authorization.service';
import { AuthPrincipal } from '../auth/auth.types';

const PERSONAL_MAX_COLLABORATORS = 2;
const ASSIGNABLE_ROLES = new Set(['member', 'admin']);

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
  createdAt: Date;
}

@Injectable()
export class OrganizationsService {
  constructor(
    private prisma: PrismaService,
    private authz: AuthorizationService,
    private audit: AuditService,
  ) {}

  private slugify(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32);
    return `${base || 'org'}-${randomBytes(3).toString('hex')}`;
  }

  private publicOrg(org: OrganizationRow) {
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      type: org.type,
      status: org.status,
      createdAt: org.createdAt,
    };
  }

  async createTeam(actor: AuthPrincipal, name: string) {
    if (actor.type !== 'human') {
      throw new ForbiddenException(
        'Only human identities can create organizations',
      );
    }

    const org = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: { name, slug: this.slugify(name), type: 'team' },
      });
      await tx.organizationMembership.create({
        data: {
          organizationId: created.id,
          identityId: actor.id,
          role: 'owner',
        },
      });
      return created;
    });

    await this.audit.log({
      actorId: actor.id,
      organizationId: org.id,
      action: 'organization.create',
      targetType: 'organization',
      targetId: org.id,
      metadata: { name, type: 'team' },
    });

    return this.publicOrg(org);
  }

  async findMine(actor: AuthPrincipal) {
    const memberships = await this.prisma.organizationMembership.findMany({
      where: { identityId: actor.id },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => ({
      ...this.publicOrg(m.organization),
      role: m.role,
    }));
  }

  async findOne(actor: AuthPrincipal, id: string) {
    const myRole = await this.authz.assertOrganizationMember(actor.id, id);

    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        memberships: {
          include: {
            identity: {
              select: { id: true, name: true, email: true, type: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        projects: { select: { id: true, name: true, createdAt: true } },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');

    return {
      ...this.publicOrg(org),
      myRole,
      members: org.memberships.map((m) => ({
        identityId: m.identityId,
        name: m.identity.name,
        email: m.identity.email,
        type: m.identity.type,
        role: m.role,
      })),
      projects: org.projects,
    };
  }

  async rename(actor: AuthPrincipal, id: string, name: string) {
    await this.authz.assertOrganizationAdmin(actor.id, id);
    const org = await this.prisma.organization.update({
      where: { id },
      data: { name },
    });

    await this.audit.log({
      actorId: actor.id,
      organizationId: id,
      action: 'organization.update',
      targetType: 'organization',
      targetId: id,
      metadata: { name },
    });

    return this.publicOrg(org);
  }

  async remove(actor: AuthPrincipal, id: string) {
    await this.authz.assertOrganizationOwner(actor.id, id);

    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        _count: { select: { projects: true, serviceAccounts: true } },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (org.type === 'personal') {
      throw new ForbiddenException('Cannot delete a personal workspace');
    }
    if (org._count.projects > 0) {
      throw new ConflictException(
        'Delete or transfer all projects before deleting the organization',
      );
    }
    if (org._count.serviceAccounts > 0) {
      throw new ConflictException(
        'Delete all service accounts before deleting the organization',
      );
    }

    await this.prisma.organization.delete({ where: { id } });

    await this.audit.log({
      actorId: actor.id,
      organizationId: id,
      action: 'organization.delete',
      targetType: 'organization',
      targetId: id,
      metadata: { name: org.name },
    });

    return { deleted: true };
  }

  async addMember(
    actor: AuthPrincipal,
    orgId: string,
    email: string,
    role: string,
  ) {
    if (!ASSIGNABLE_ROLES.has(role)) {
      throw new ForbiddenException('Role must be "member" or "admin"');
    }
    // Призначати адмінів може лише owner; звичайних учасників — owner/admin.
    if (role === 'admin') {
      await this.authz.assertOrganizationOwner(actor.id, orgId);
    } else {
      await this.authz.assertOrganizationAdmin(actor.id, orgId);
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const normalizedEmail = email.trim().toLowerCase();
    const identity = await this.prisma.identity.findUnique({
      where: { email: normalizedEmail },
    });
    if (!identity || identity.type !== 'human') {
      throw new NotFoundException('No human account found for this email');
    }

    const existing = await this.prisma.organizationMembership.findUnique({
      where: {
        organizationId_identityId: {
          organizationId: orgId,
          identityId: identity.id,
        },
      },
    });
    if (existing) {
      throw new ConflictException('Identity is already a member');
    }

    if (org.type === 'personal') {
      if (role !== 'member') {
        throw new ForbiddenException(
          'Personal workspace collaborators must have the "member" role',
        );
      }
      const collaborators = await this.prisma.organizationMembership.count({
        where: { organizationId: orgId, role: { not: 'owner' } },
      });
      if (collaborators >= PERSONAL_MAX_COLLABORATORS) {
        throw new ForbiddenException(
          `Personal workspace allows at most ${PERSONAL_MAX_COLLABORATORS} collaborators`,
        );
      }
    }

    const membership = await this.prisma.organizationMembership.create({
      data: { organizationId: orgId, identityId: identity.id, role },
    });

    await this.audit.log({
      actorId: actor.id,
      organizationId: orgId,
      action: 'membership.invite',
      targetType: 'identity',
      targetId: identity.id,
      metadata: { email: normalizedEmail, role },
    });

    return {
      id: membership.id,
      identityId: identity.id,
      name: identity.name,
      email: identity.email,
      role: membership.role,
    };
  }

  async changeRole(
    actor: AuthPrincipal,
    orgId: string,
    targetIdentityId: string,
    newRole: string,
  ) {
    await this.authz.assertOrganizationOwner(actor.id, orgId);
    if (!ASSIGNABLE_ROLES.has(newRole)) {
      throw new ForbiddenException('Role must be "member" or "admin"');
    }
    if (targetIdentityId === actor.id) {
      throw new ForbiddenException(
        'Use transfer-ownership to change your own role',
      );
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const membership = await this.prisma.organizationMembership.findUnique({
      where: {
        organizationId_identityId: {
          organizationId: orgId,
          identityId: targetIdentityId,
        },
      },
    });
    if (!membership) throw new NotFoundException('Membership not found');
    if (membership.role === 'owner') {
      throw new ForbiddenException('Cannot change the owner role directly');
    }
    if (org.type === 'personal' && newRole !== 'member') {
      throw new ForbiddenException(
        'Personal workspace collaborators must have the "member" role',
      );
    }

    const updated = await this.prisma.organizationMembership.update({
      where: { id: membership.id },
      data: { role: newRole },
    });

    await this.audit.log({
      actorId: actor.id,
      organizationId: orgId,
      action: 'membership.role_change',
      targetType: 'identity',
      targetId: targetIdentityId,
      metadata: { from: membership.role, to: newRole },
    });

    return { identityId: targetIdentityId, role: updated.role };
  }

  async removeMember(
    actor: AuthPrincipal,
    orgId: string,
    targetIdentityId: string,
  ) {
    const actorRole = await this.authz.assertOrganizationMember(
      actor.id,
      orgId,
    );

    const membership = await this.prisma.organizationMembership.findUnique({
      where: {
        organizationId_identityId: {
          organizationId: orgId,
          identityId: targetIdentityId,
        },
      },
    });
    if (!membership) throw new NotFoundException('Membership not found');
    if (membership.role === 'owner') {
      throw new ForbiddenException(
        'Transfer ownership before removing the owner',
      );
    }

    const isSelf = targetIdentityId === actor.id;
    if (!isSelf) {
      if (actorRole !== 'owner' && actorRole !== 'admin') {
        throw new ForbiddenException('Organization admin access required');
      }
      // Адмін не може прибрати іншого адміна — це прерогатива owner.
      if (membership.role === 'admin' && actorRole !== 'owner') {
        throw new ForbiddenException('Only the owner can remove an admin');
      }
    }

    // Прибираючи учасника, відкликаємо його гранти на проєкти цієї org —
    // інакше доступ до секретів "переживе" членство.
    await this.prisma.$transaction(async (tx) => {
      await tx.organizationMembership.delete({ where: { id: membership.id } });
      const projects = await tx.project.findMany({
        where: { organizationId: orgId },
        select: { id: true },
      });
      const projectIds = projects.map((p) => p.id);
      if (projectIds.length > 0) {
        await tx.grant.deleteMany({
          where: {
            identityId: targetIdentityId,
            projectId: { in: projectIds },
          },
        });
      }
    });

    await this.audit.log({
      actorId: actor.id,
      organizationId: orgId,
      action: 'membership.remove',
      targetType: 'identity',
      targetId: targetIdentityId,
      metadata: { role: membership.role, self: isSelf },
    });

    return { removed: true };
  }

  async transferOwnership(
    actor: AuthPrincipal,
    orgId: string,
    toIdentityId: string,
  ) {
    await this.authz.assertOrganizationOwner(actor.id, orgId);

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (org.type === 'personal') {
      throw new ForbiddenException(
        'Cannot transfer ownership of a personal workspace',
      );
    }
    if (toIdentityId === actor.id) {
      throw new ForbiddenException('You already own this organization');
    }

    const target = await this.prisma.organizationMembership.findUnique({
      where: {
        organizationId_identityId: {
          organizationId: orgId,
          identityId: toIdentityId,
        },
      },
      include: { identity: { select: { type: true } } },
    });
    if (!target) {
      throw new NotFoundException(
        'Target is not a member of this organization',
      );
    }
    if (target.identity.type !== 'human') {
      throw new ForbiddenException(
        'Ownership can only be transferred to a human identity',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.organizationMembership.update({
        where: {
          organizationId_identityId: {
            organizationId: orgId,
            identityId: actor.id,
          },
        },
        data: { role: 'admin' },
      });
      await tx.organizationMembership.update({
        where: { id: target.id },
        data: { role: 'owner' },
      });
    });

    await this.audit.log({
      actorId: actor.id,
      organizationId: orgId,
      action: 'organization.transfer_ownership',
      targetType: 'organization',
      targetId: orgId,
      metadata: { from: actor.id, to: toIdentityId },
    });

    return { ownerId: toIdentityId };
  }
}
