import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TokenService } from '../auth/token.service';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private tokenService: TokenService,
  ) {}

  // --- Identity ---
  createIdentity(name: string, type: string) {
    return this.prisma.identity.create({
      data: { name, type },
      select: { id: true, name: true, type: true, isSuperadmin: true, createdAt: true },
    });
  }

  listIdentities() {
    return this.prisma.identity.findMany({
      select: { id: true, name: true, type: true, isSuperadmin: true, createdAt: true },
    });
  }

  // --- Tokens ---
  async issueToken(identityId: string, label?: string) {
    const identity = await this.prisma.identity.findUnique({ where: { id: identityId } });
    if (!identity) throw new NotFoundException('Identity not found');

    // повертаємо сам токен — показуємо один раз
    const token = await this.tokenService.issue(identityId, label);
    return { token };
  }

  async revokeToken(tokenId: string) {
    const token = await this.prisma.token.findUnique({ where: { id: tokenId } });
    if (!token) throw new NotFoundException('Token not found');
    await this.tokenService.revoke(tokenId);
    return { revoked: true };
  }

  listTokens(identityId: string) {
    // НЕ повертаємо tokenHash — лише метадані
    return this.prisma.token.findMany({
      where: { identityId },
      select: { id: true, label: true, createdAt: true, expiresAt: true, revokedAt: true },
    });
  }

  // --- Grants ---
  async createGrant(
    identityId: string,
    projectId: string,
    role: string,
    environment?: string,
  ) {
    const identity = await this.prisma.identity.findUnique({ where: { id: identityId } });
    if (!identity) throw new NotFoundException('Identity not found');

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    return this.prisma.grant.create({
      data: { identityId, projectId, role, environment: environment ?? null },
    });
  }

  async revokeGrant(grantId: string) {
    const grant = await this.prisma.grant.findUnique({ where: { id: grantId } });
    if (!grant) throw new NotFoundException('Grant not found');
    await this.prisma.grant.delete({ where: { id: grantId } });
    return { revoked: true };
  }

  listGrants(identityId: string) {
    return this.prisma.grant.findMany({ where: { identityId } });
  }
}
