import { Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../prisma.service';

const TOKEN_PREFIX = 'sm_';
const TOKEN_BYTES = 32;

@Injectable()
export class TokenService {
  constructor(private prisma: PrismaService) {}

  /** Хешуємо токен через SHA-256 (швидкий — для високоентропійних токенів це правильно). */
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Створює новий токен для Identity.
   * Повертає САМ токен — його показують користувачу один раз і більше ніде не зберігають.
   */
  async issue(identityId: string, label?: string): Promise<string> {
    const token = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('hex');
    const tokenHash = this.hash(token);

    await this.prisma.token.create({
      data: { identityId, tokenHash, label },
    });

    return token;
  }

  /**
   * Перевіряє токен. Повертає Identity, якщо токен валідний,
   * або null якщо ні (не знайдено / відкликано / протерміновано).
   */
  async verify(token: string) {
    const tokenHash = this.hash(token);

    const record = await this.prisma.token.findUnique({
      where: { tokenHash },
      include: { identity: true },
    });

    if (!record) return null;
    if (record.revokedAt) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;

    return record.identity;
  }

  /** Відкликає токен (м'яко — лишаємо для аудиту). */
  async revoke(tokenId: string) {
    return this.prisma.token.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
  }
}
