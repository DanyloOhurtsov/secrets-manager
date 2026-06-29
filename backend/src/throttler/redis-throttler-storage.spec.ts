import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisThrottlerStorage } from './redis-throttler-storage';

// Юніт-тести Redis-сховища throttler з мокнутим ioredis-клієнтом. Перевіряємо
// (1) мапінг результату EVAL у ThrottlerStorageRecord (включно з конвертацією
// ms→секунди), (2) аргументи EVAL, (3) безпечну деградацію до in-memory при
// збої Redis (fail-open до per-process лічильника, а не вимкнення захисту).
describe('RedisThrottlerStorage', () => {
  let evalMock: jest.Mock;
  let storage: RedisThrottlerStorage;

  beforeEach(() => {
    evalMock = jest.fn();
    const fakeRedis = { eval: evalMock } as unknown as Redis;
    storage = new RedisThrottlerStorage(fakeRedis);
  });

  afterEach(async () => {
    // Чистимо таймери in-memory fallback (якщо тест його зачепив).
    await storage.onModuleDestroy();
    jest.restoreAllMocks();
  });

  it('passes the right KEYS/ARGV to EVAL (hit key + block key)', async () => {
    evalMock.mockResolvedValue([1, 60000, 0, 0]);

    await storage.increment('abc', 60000, 5, 60000, 'default');

    const call = evalMock.mock.calls[0] as unknown[];
    expect(typeof call[0]).toBe('string');
    expect(call[0]).toContain('INCR'); // це справді інкремент-скрипт
    expect(call[1]).toBe(2); // numKeys
    expect(call[2]).toBe('abc'); // hit key
    expect(call[3]).toBe('abc:block'); // block key
    expect(call.slice(4)).toEqual([60000, 5, 60000]); // ttl, limit, blockDuration
  });

  it('maps an allowed result and converts ms→seconds (ceil)', async () => {
    // 1500ms → 2с, 0ms → 0с.
    evalMock.mockResolvedValue([3, 1500, 0, 0]);

    const res = await storage.increment('k', 60000, 5, 60000, 'default');

    expect(res).toEqual({
      totalHits: 3,
      timeToExpire: 2,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('maps a blocked result (isBlocked true + block expiry in seconds)', async () => {
    evalMock.mockResolvedValue([6, 60000, 1, 60000]);

    const res = await storage.increment('k', 60000, 5, 60000, 'default');

    expect(res).toEqual({
      totalHits: 6,
      timeToExpire: 60,
      isBlocked: true,
      timeToBlockExpire: 60,
    });
  });

  it('falls back to in-memory throttling when Redis fails, warning once', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'));

    // Перший виклик: Redis впав → деградація до in-memory (перший хіт = 1).
    const first = await storage.increment('user', 60000, 5, 60000, 'default');
    expect(first.totalHits).toBe(1);
    expect(first.isBlocked).toBe(false);

    // Другий виклик (Redis і досі недоступний): лічильник in-memory росте →
    // throttling НЕ вимкнено, просто per-process.
    const second = await storage.increment('user', 60000, 5, 60000, 'default');
    expect(second.totalHits).toBe(2);

    // Попередження про деградацію логуємо лише раз, без спаму.
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps blocking via the in-memory fallback once the limit is exceeded', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    evalMock.mockRejectedValue(new Error('down'));

    // limit=2: 1,2 дозволені, 3-й — заблокований навіть у fallback-режимі.
    const r1 = await storage.increment('ip', 60000, 2, 60000, 'default');
    const r2 = await storage.increment('ip', 60000, 2, 60000, 'default');
    const r3 = await storage.increment('ip', 60000, 2, 60000, 'default');

    expect(r1.isBlocked).toBe(false);
    expect(r2.isBlocked).toBe(false);
    expect(r3.isBlocked).toBe(true);
  });

  // --- Lifecycle: власний клієнт закривається РІВНО один раз ------------------
  // NestJS кличе destroy-хук на КОЖНОМУ токені, під яким є інстанс; ThrottlerStorage
  // аліасимо на цей провайдер (useExisting), тож хук прилітає двічі. Раніше другий
  // виклик робив quit() на вже закритому зʼєднанні → catch → ioredis.disconnect(),
  // що лишало ref-таймер безпеки (≈2с) і тримало event loop живим (Jest open-handle).

  // Власне зʼєднання (ownsClient=true) створюється лише коли redis НЕ передано в
  // конструктор — тут підставляємо мок-клієнт і вмикаємо володіння вручну, щоб не
  // тягнути реальний Redis у юніт-тест.
  function ownedStorage(redisMock: Partial<Redis>): RedisThrottlerStorage {
    const s = new RedisThrottlerStorage(redisMock as Redis);
    (s as unknown as { ownsClient: boolean }).ownsClient = true;
    return s;
  }

  it('closes the owned redis client exactly once even when destroyed twice', async () => {
    const quit = jest.fn().mockResolvedValue('OK');
    const disconnect = jest.fn();
    const s = ownedStorage({ eval: jest.fn(), quit, disconnect });

    // Симулюємо подвійний destroy від aliased-провайдера (навіть паралельно).
    await Promise.all([s.onModuleDestroy(), s.onModuleDestroy()]);
    await s.onModuleDestroy();

    // quit() рівно раз; disconnect() (саме він лишав ref-таймер) — жодного разу.
    expect(quit).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('falls back to a single disconnect() when quit() fails, and stays idempotent', async () => {
    const quit = jest.fn().mockRejectedValue(new Error('Connection is closed.'));
    const disconnect = jest.fn();
    const s = ownedStorage({ eval: jest.fn(), quit, disconnect });

    await s.onModuleDestroy();
    await s.onModuleDestroy();

    // Навіть коли quit() падає (Redis недоступний) — одна спроба quit і один
    // disconnect, без повторів на наступних destroy-викликах.
    expect(quit).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not touch an externally-owned client on destroy', async () => {
    const quit = jest.fn();
    const disconnect = jest.fn();
    // redis передано ззовні → ownsClient=false (його lifecycle не наш).
    const s = new RedisThrottlerStorage({
      eval: jest.fn(),
      quit,
      disconnect,
    } as unknown as Redis);

    await s.onModuleDestroy();

    expect(quit).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });
});
