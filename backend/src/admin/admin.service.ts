import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TokenService } from '../auth/token.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private tokenService: TokenService,
    private audit: AuditService,
  ) {}

  // --- Identity ---
  async createIdentity(actorId: string, name: string, type: string) {
    const identity = await this.prisma.identity.create({
      data: { name, type },
      select: {
        id: true,
        name: true,
        type: true,
        isSuperadmin: true,
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
        type: true,
        isSuperadmin: true,
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
  ) {
    const identity = await this.prisma.identity.findUnique({
      where: { id: identityId },
    });
    if (!identity) throw new NotFoundException('Identity not found');

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');

    const grant = await this.prisma.grant.create({
      data: { identityId, projectId, role, environment: environment ?? null },
    });

    await this.audit.log({
      actorId,
      action: 'grant.create',
      targetType: 'grant',
      targetId: grant.id,
      metadata: {
        identityId,
        projectId,
        role,
        environment: environment ?? null,
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
      metadata: { identityId: grant.identityId, projectId: grant.projectId },
    });

    return { revoked: true };
  }

  listGrants(identityId: string) {
    return this.prisma.grant.findMany({ where: { identityId } });
  }

  // --- Audit ---
  listAuditLog(limit = 100) {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
