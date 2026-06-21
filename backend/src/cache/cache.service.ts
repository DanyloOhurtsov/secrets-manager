import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      // не валити застосунок, якщо Redis недоступний — кеш не критичний
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });
    this.redis.on('error', (err) => {
      this.logger.warn(`Redis error: ${err.message}`);
    });
  }

  /** Отримати значення з кешу. Повертає null, якщо нема або Redis недоступний. */
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null; // кеш-промах при збої — не ламаємо запит
    }
  }

  /** Покласти значення в кеш із TTL у секундах. */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      // збій запису в кеш — не критичний
    }
  }

  /** Видалити з кешу (інвалідація). */
  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
      // ignore
    }
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
