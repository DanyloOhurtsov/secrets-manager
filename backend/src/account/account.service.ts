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

@Injectable()
export class AccountService {
  constructor(
    private prisma: PrismaService,
    private tokens: TokenService,
    private audit: AuditService,
    private authz: AuthorizationService,
  ) {}

  // Остання активна org для редіректу з кореня. Повертаємо лише якщо членство
  // ще дійсне — інакше null (фронт впаде на першу доступну org).
  async getActiveOrg(actor: AuthPrincipal) {
    const identity = await this.prisma.identity.findUnique({
      where: { id: actor.id },
      select: { lastActiveOrgId: true },
    });
    const orgId = identity?.lastActiveOrgId ?? null;
    if (!orgId) return { organizationId: null };

    const role = await this.authz.getOrganizationRole(actor.id, orgId);
    return { organizationId: role ? orgId : null };
  }

  async setActiveOrg(actor: AuthPrincipal, organizationId: string) {
    await this.authz.assertOrganizationMember(actor.id, organizationId);
    await this.prisma.identity.update({
      where: { id: actor.id },
      data: { lastActiveOrgId: organizationId },
    });
    return { organizationId };
  }

  async createToken(
    actor: AuthPrincipal,
    label?: string,
    expiresInDays?: number,
  ) {
    if (actor.type !== 'human') {
      throw new ForbiddenException(
        'Only human identities manage personal tokens here',
      );
    }

    const token = await this.tokens.issue(
      actor.id,
      label,
      expiryFromDays(expiresInDays),
    );

    await this.audit.log({
      actorId: actor.id,
      action: 'token.issue',
      targetType: 'identity',
      targetId: actor.id,
      metadata: { label: label ?? null, self: true },
    });

    // Сам токен показуємо лише раз.
    return { token };
  }

  listTokens(actor: AuthPrincipal) {
    return this.prisma.token.findMany({
      where: { identityId: actor.id },
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

  async revokeToken(actor: AuthPrincipal, tokenId: string) {
    const token = await this.prisma.token.findUnique({
      where: { id: tokenId },
    });
    if (!token || token.identityId !== actor.id) {
      throw new NotFoundException('Token not found');
    }

    await this.tokens.revoke(tokenId);

    await this.audit.log({
      actorId: actor.id,
      action: 'token.revoke',
      targetType: 'token',
      targetId: tokenId,
      metadata: { self: true },
    });

    return { revoked: true };
  }
}
