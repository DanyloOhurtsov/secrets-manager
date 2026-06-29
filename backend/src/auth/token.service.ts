import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const token = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('hex');
    const tokenHash = this.hash(token);

    // Якщо передано tx — рядок токена створюється В ТІЙ САМІЙ транзакції, що й
    // обов'язковий аудит. Збій аудиту відкочує токен: повернений рядок стає
    // неробочим (рядка в БД немає), а сам метод кидає 503 і токен не віддає.
    await (tx ?? this.prisma).token.create({
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

  /**
   * Видаляє всі токени identity У МЕЖАХ переданого tx і повертає їхні hash, щоб
   * викликач інвалідував кеш ПІСЛЯ коміту (через invalidateCache). Дозволяє
   * видалити service-акаунт разом із токенами та аудитом однією транзакцією.
   */
  async deleteAllForIdentityInTransaction(
    tx: Prisma.TransactionClient,
    identityId: string,
  ): Promise<string[]> {
    const tokens = await tx.token.findMany({
      where: { identityId },
      select: { tokenHash: true },
    });
    await tx.token.deleteMany({ where: { identityId } });
    return tokens.map((t) => t.tokenHash);
  }

  /**
   * Відкликає токен (revokedAt) і повертає його tokenHash. Якщо передано tx —
   * оновлення йде в транзакції (для транзакційного аудиту), а кеш слід
   * інвалідувати ПІСЛЯ коміту через invalidateCache(hash). Без tx — інвалідуємо
   * одразу (миттєве відкликання).
   */
  async revoke(
    tokenId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const token = await (tx ?? this.prisma).token.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });

    if (!tx) {
      await this.cache.del(this.cacheKey(token.tokenHash));
    }

    return token.tokenHash;
  }

  /** Інвалідація кешу токена — викликати ПІСЛЯ коміту транзакції відкликання. */
  async invalidateCache(tokenHash: string): Promise<void> {
    await this.cache.del(this.cacheKey(tokenHash));
  }
}
