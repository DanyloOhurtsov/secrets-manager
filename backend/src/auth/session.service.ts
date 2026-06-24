import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { AuthPrincipal } from './auth.types';

const SESSION_PREFIX = 'sess_';
const SESSION_BYTES = 32;
const SESSION_TTL_DAYS = 30;

@Injectable()
export class SessionService {
  constructor(private prisma: PrismaService) {}

  private hash(sessionToken: string): string {
    return createHash('sha256').update(sessionToken).digest('hex');
  }

  async issue(identityId: string): Promise<string> {
    const sessionToken =
      SESSION_PREFIX + randomBytes(SESSION_BYTES).toString('hex');
    const sessionHash = this.hash(sessionToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + SESSION_TTL_DAYS);

    await this.prisma.session.create({
      data: { identityId, sessionHash, expiresAt },
    });

    return sessionToken;
  }

  async verify(sessionToken: string): Promise<AuthPrincipal | null> {
    const sessionHash = this.hash(sessionToken);
    const record = await this.prisma.session.findUnique({
      where: { sessionHash },
      include: { identity: true },
    });

    if (!record) return null;
    if (record.revokedAt) return null;
    if (record.expiresAt < new Date()) return null;

    return {
      id: record.identity.id,
      name: record.identity.name,
      email: record.identity.email,
      type: record.identity.type,
      isSuperadmin: record.identity.isSuperadmin,
      serviceOrganizationId: record.identity.serviceOrganizationId,
      authMethod: 'session',
      sessionId: record.id,
    };
  }

  /**
   * М'яко відкликає сесію (logout): виставляє revokedAt. Сесії не кешуються, тож
   * наступний verify одразу побачить revokedAt і поверне null → 401.
   * updateMany (а не update) робить операцію ідемпотентною: повторний logout або
   * вже відкликана/неіснуюча сесія не кидають помилку.
   */
  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
