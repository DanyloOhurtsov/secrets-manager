import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import Redis from 'ioredis';

// Форма запису, яку очікує ThrottlerGuard (структурно дорівнює
// ThrottlerStorageRecord з @nestjs/throttler). Тримаємо локально, щоб не
// тягнути глибокий import із dist/ пакета.
interface StorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

// Атомарний fixed-window лічильник у Redis. Один EVAL виконує INCR + виставлення
// TTL + перевірку/встановлення блокування, тож кілька інстансів бекенду ділять
// один і той самий ліміт (на відміну від in-memory сховища, яке лічить окремо в
// кожному процесі). Повертає масив [hits, hitTtlMs, blocked(0|1), blockTtlMs].
const INCREMENT_LUA = `
local hitKey = KEYS[1]
local blockKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])

-- Уже заблоковано: не лічимо запит, лише повертаємо залишок блокування.
local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
  local current = tonumber(redis.call('GET', hitKey) or '0')
  local hitTtl = redis.call('PTTL', hitKey)
  if hitTtl < 0 then hitTtl = 0 end
  return { current, hitTtl, 1, blockTtl }
end

local hits = redis.call('INCR', hitKey)
if hits == 1 then
  redis.call('PEXPIRE', hitKey, ttl)
end
local hitTtl = redis.call('PTTL', hitKey)
if hitTtl < 0 then
  -- ключ без TTL (теоретично) — підстраховуємось, щоб вікно не зависло назавжди.
  redis.call('PEXPIRE', hitKey, ttl)
  hitTtl = ttl
end

local blocked = 0
local blockRemaining = 0
if hits > limit then
  redis.call('SET', blockKey, '1', 'PX', blockDuration)
  blocked = 1
  blockRemaining = blockDuration
end

return { hits, hitTtl, blocked, blockRemaining }
`;

/**
 * Redis-сховище для @nestjs/throttler. Ліміти спільні між усіма інстансами
 * бекенду. Якщо Redis недоступний — НЕ вимикаємо throttling мовчки, а
 * деградуємо до вбудованого in-memory сховища (per-process) із попередженням у
 * лог. Так захист залишається ввімкненим навіть під час збою Redis.
 */
@Injectable()
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnModuleDestroy
{
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly redis: Redis;
  private readonly ownsClient: boolean;
  // Резервне per-process сховище на випадок недоступності Redis.
  private readonly fallback = new ThrottlerStorageService();
  private degraded = false;
  // Меморізований teardown: гарантує, що власний клієнт закриється РІВНО один
  // раз, навіть якщо destroy-хук прилетить кілька разів (див. onModuleDestroy).
  private shutdownPromise?: Promise<void>;

  // redis можна передати ззовні (для тестів); інакше створюємо власне з'єднання,
  // окреме від CacheService, щоб throttling не конкурував за кеш-конекшн.
  constructor(@Optional() redis?: Redis) {
    if (redis) {
      this.redis = redis;
      this.ownsClient = false;
    } else {
      this.redis = new Redis(
        process.env.REDIS_URL ?? 'redis://localhost:6379',
        {
          maxRetriesPerRequest: 2,
          // не зависати в черзі під час простою Redis — хай EVAL одразу впаде у
          // catch і ми деградуємо до in-memory.
          enableOfflineQueue: false,
        },
      );
      this.redis.on('error', () => {
        // Деталі помилки логуються один раз у increment() при деградації, щоб
        // не спамити лог на кожен reconnect-attempt.
      });
      this.ownsClient = true;
    }
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<StorageRecord> {
    try {
      const raw = (await this.redis.eval(
        INCREMENT_LUA,
        2,
        key,
        `${key}:block`,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number, number];

      if (this.degraded) {
        this.degraded = false;
        this.logger.log('Redis throttler storage recovered.');
      }

      const [totalHits, timeToExpireMs, isBlocked, timeToBlockExpireMs] = raw;
      return {
        totalHits: Number(totalHits),
        // Guard очікує секунди (як in-memory сховище: Math.ceil(ms/1000)).
        timeToExpire: Math.ceil(Number(timeToExpireMs) / 1000),
        isBlocked: Number(isBlocked) === 1,
        timeToBlockExpire: Math.ceil(Number(timeToBlockExpireMs) / 1000),
      };
    } catch (err) {
      if (!this.degraded) {
        this.degraded = true;
        this.logger.warn(
          `Redis throttler storage unavailable, falling back to in-memory throttling: ${
            (err as Error).message
          }`,
        );
      }
      // Fail-open лише до per-process лічильника, НЕ вимикаючи захист повністю.
      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    // NestJS викликає destroy-хук на КОЖНОМУ DI-токені, під яким зареєстровано
    // інстанс. Ми навмисно аліасимо ThrottlerStorage на цей самий провайдер
    // (throttling.module.ts → useExisting), тож хук прилітає двічі на той самий
    // об'єкт. Без захисту другий виклик робив би quit() на вже закритому
    // зʼєднанні ("Connection is closed."), падав у catch і кликав
    // ioredis.disconnect(), який лишає ref-таймер безпеки
    // (setTimeout(stream.destroy, disconnectTimeout ≈ 2с)). Той таймер тримає
    // event loop живим і дає Jest відоме "did not exit one second after the test
    // run has completed". Тому закриваємо ресурси ідемпотентно — рівно один раз.
    if (!this.shutdownPromise) {
      this.shutdownPromise = this.shutdown();
    }
    await this.shutdownPromise;
  }

  private async shutdown(): Promise<void> {
    // Таймери in-memory fallback прибираємо завжди (idempotent, без зʼєднання).
    this.fallback.onApplicationShutdown();
    // Зовнішній клієнт нам не належить — його lifecycle лишаємо власнику.
    if (!this.ownsClient) {
      return;
    }
    try {
      await this.redis.quit();
    } catch {
      // Резерв, якщо quit() не вдався (Redis недоступний): рвемо зʼєднання.
      this.redis.disconnect();
    }
  }
}
