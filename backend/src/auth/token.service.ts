import { Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { CacheService } from '../cache/cache.service';
import { AuthPrincipal } from './auth.types';

const TOKEN_PREFIX = 'sm_';
const TOKEN_BYTES = 32;
const CACHE_TTL_SECONDS = 30;

// що кешуємо: мінімум для авторизації
type CachedIdentity = AuthPrincipal;

@Injectable()
export class TokenService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private cacheKey(tokenHash: string): string {
    return `token:${tokenHash}`;
  }

  async issue(
    identityId: string,
    label?: string,
    expiresAt?: Date | null,
  ): Promise<string> {
    const token = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('hex');
    const tokenHash = this.hash(token);

    await this.prisma.token.create({
      data: { identityId, tokenHash, label, expiresAt: expiresAt ?? null },
    });

    return token;
  }

  async verify(token: string): Promise<CachedIdentity | null> {
    const tokenHash = this.hash(token);
    const key = this.cacheKey(tokenHash);

    // 1. Спершу кеш
    const cached = await this.cache.get<CachedIdentity>(key);
    if (cached) return cached;

    // 2. Кеш-промах → БД
    const record = await this.prisma.token.findUnique({
      where: { tokenHash },
      include: { identity: true },
    });

    if (!record) return null;
    if (record.revokedAt) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;

    const identity: CachedIdentity = {
      id: record.identity.id,
      name: record.identity.name,
      email: record.identity.email,
      type: record.identity.type,
      isSuperadmin: record.identity.isSuperadmin,
      serviceOrganizationId: record.identity.serviceOrganizationId,
      authMethod: 'token',
    };

    // 3. Кладемо в кеш із коротким TTL (страховка на випадок збою інвалідації)
    await this.cache.set(key, identity, CACHE_TTL_SECONDS);

    // 4. Best-effort відмітка останнього використання. Робимо лише на кеш-промах
    //    (раз на TTL), щоб не бити БД на кожен запит; помилку ковтаємо.
    void this.prisma.token
      .update({ where: { tokenHash }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return identity;
  }

  /**
   * Видаляє всі токени identity (hard delete) + інвалідує їхній кеш.
   * Потрібно для видалення service-акаунтів: FK на Token — RESTRICT,
   * тож identity не видалити, поки лишилися токени.
   */
  async deleteAllForIdentity(identityId: string): Promise<void> {
    const tokens = await this.prisma.token.findMany({
      where: { identityId },
      select: { tokenHash: true },
    });
    await this.prisma.token.deleteMany({ where: { identityId } });
    await Promise.all(
      tokens.map((t) => this.cache.del(this.cacheKey(t.tokenHash))),
    );
  }

  /** Відкликає токен (м'яко) + миттєво інвалідує кеш. */
  async revoke(tokenId: string) {
    const token = await this.prisma.token.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });

    // миттєва інвалідація: відкликаний токен одразу перестає працювати
    await this.cache.del(this.cacheKey(token.tokenHash));

    return token;
  }
}
