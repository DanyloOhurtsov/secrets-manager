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

  async issue(identityId: string, label?: string): Promise<string> {
    const token = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('hex');
    const tokenHash = this.hash(token);

    await this.prisma.token.create({
      data: { identityId, tokenHash, label },
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

    return identity;
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
