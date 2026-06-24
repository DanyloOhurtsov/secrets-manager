import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../auth/authorization.service';
import { TokenService } from '../auth/token.service';
import { AuthPrincipal } from '../auth/auth.types';
import { expiryFromDays } from '../common/expiry';

const PERSONAL_MAX_SERVICE_ACCOUNTS = 2;

@Injectable()
export class ServiceAccountsService {
  constructor(
    private prisma: PrismaService,
    private authz: AuthorizationService,
    private audit: AuditService,
    private tokens: TokenService,
  ) {}

  async create(actor: AuthPrincipal, orgId: string, name: string) {
    await this.authz.assertOrganizationAdmin(actor.id, orgId);

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    if (org.type === 'personal') {
      const count = await this.prisma.identity.count({
        where: { serviceOrganizationId: orgId, type: 'service' },
      });
      if (count >= PERSONAL_MAX_SERVICE_ACCOUNTS) {
        throw new ForbiddenException(
          `Personal workspace allows at most ${PERSONAL_MAX_SERVICE_ACCOUNTS} service accounts`,
        );
      }
    }

    const identity = await this.prisma.identity.create({
      data: { name, type: 'service', serviceOrganizationId: orgId },
      select: {
        id: true,
        name: true,
        type: true,
        serviceOrganizationId: true,
        createdAt: true,
      },
    });

    await this.audit.log({
      actorId: actor.id,
      organizationId: orgId,
      action: 'service_account.create',
      targetType: 'identity',
      targetId: identity.id,
      metadata: { name },
    });

    return identity;
  }

  async list(actor: AuthPrincipal, orgId: string) {
    await this.authz.assertOrganizationAdmin(actor.id, orgId);
    return this.prisma.identity.findMany({
      where: { serviceOrganizationId: orgId, type: 'service' },
      select: {
        id: true,
        name: true,
        type: true,
        serviceOrganizationId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async getServiceAccountOrThrow(orgId: string, identityId: string) {
    const account = await this.prisma.identity.findUnique({
      where: { id: identityId },
    });
    if (
      !account ||
      account.type !== 'service' ||
      account.serviceOrganizationId !== orgId
    ) {
      throw new NotFoundException('Service account not found');
    }
    return account;
  }

  async issueToken(
    actor: AuthPrincipal,
    orgId: string,
    identityId: string,
    label?: string,
    expiresInDays?: number,
  ) {
    await this.authz.assertOrganizationAdmin(actor.id, orgId);
    await this.getServiceAccountOrThrow(orgId, identityId);

    const token = await this.tokens.issue(
      identityId,
      label,
      expiryFromDays(expiresInDays),
    );

    await this.audit.log({
      actorId: actor.id,
      organizationId: orgId,
      action: 'token.issue',
      targetType: 'identity',
      targetId: identityId,
      metadata: { label: label ?? null },
    });

    return { token };
  }

  async listTokens(actor: AuthPrincipal, orgId: string, identityId: string) {
    await this.authz.assertOrganizationAdmin(actor.id, orgId);
    await this.getServiceAccountOrThrow(orgId, identityId);
    return this.prisma.token.findMany({
      where: { identityId },
      select: {
        id: true,
        label: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeToken(
    actor: AuthPrincipal,
    orgId: string,
    identityId: string,
    tokenId: string,
  ) {
    await this.authz.assertOrganizationAdmin(actor.id, orgId);
    await this.getServiceAccountOrThrow(orgId, identityId);

    const token = await this.prisma.token.findUnique({
      where: { id: tokenId },
    });
    if (!token || token.identityId !== identityId) {
      throw new NotFoundException('Token not found');
    }

    await this.tokens.revoke(tokenId);

    await this.audit.log({
      actorId: actor.id,
      organizationId: orgId,
      action: 'token.revoke',
      targetType: 'token',
      targetId: tokenId,
      metadata: { identityId },
    });

    return { revoked: true };
  }

  async remove(actor: AuthPrincipal, orgId: string, identityId: string) {
    await this.authz.assertOrganizationAdmin(actor.id, orgId);
    const account = await this.getServiceAccountOrThrow(orgId, identityId);

    // FK на Token та Grant — RESTRICT, тож приберемо їх перед самим identity.
    await this.tokens.deleteAllForIdentity(identityId);
    await this.prisma.$transaction(async (tx) => {
      await tx.grant.deleteMany({ where: { identityId } });
      await tx.identity.delete({ where: { id: identityId } });
    });

    await this.audit.log({
      actorId: actor.id,
      organizationId: orgId,
      action: 'service_account.delete',
      targetType: 'identity',
      targetId: identityId,
      metadata: { name: account.name },
    });

    return { deleted: true };
  }
}
