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

    // Видача токена + обов'язковий аудит — в одній транзакції. Якщо аудит впав,
    // рядок токена відкочується: повернений рядок неробочий і метод кидає 503.
    const token = await this.prisma.$transaction(async (tx) => {
      const issued = await this.tokens.issue(
        actor.id,
        label,
        expiryFromDays(expiresInDays),
        tx,
      );
      await this.audit.logRequired(
        {
          actorId: actor.id,
          action: 'token.issue',
          targetType: 'identity',
          targetId: actor.id,
          metadata: { label: label ?? null, self: true },
        },
        tx,
      );
      return issued;
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

    // Відкликання + аудит атомарно; кеш інвалідуємо лише після коміту.
    const tokenHash = await this.prisma.$transaction(async (tx) => {
      const hash = await this.tokens.revoke(tokenId, tx);
      await this.audit.logRequired(
        {
          actorId: actor.id,
          action: 'token.revoke',
          targetType: 'token',
          targetId: tokenId,
          metadata: { self: true },
        },
        tx,
      );
      return hash;
    });
    await this.tokens.invalidateCache(tokenHash);

    return { revoked: true };
  }
}
