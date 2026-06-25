import {
  applyE2EEnv,
  isTestSafeRedisUrl,
  requireTestDatabaseUrl,
  requireTestRedisUrl,
} from '../test/e2e-env';

// Юніт-тести на гарди безпеки e2e-середовища. Найважливіше — Redis: на відміну
// від Postgres, у нього раніше не було захисту, тож e2e flushdb міг знести
// дев/спільний Redis. Тут фіксуємо: без явного, test-safe TEST_REDIS_URL —
// відмова, і жодного фолбеку на дефолтну БД 0.

describe('e2e-env safety guards', () => {
  const ENV_KEYS = [
    'TEST_DATABASE_URL',
    'TEST_REDIS_URL',
    'DATABASE_URL',
    'REDIS_URL',
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  describe('isTestSafeRedisUrl', () => {
    it('treats a non-zero DB index as test-safe', () => {
      expect(isTestSafeRedisUrl('redis://localhost:6379/15')).toBe(true);
      expect(isTestSafeRedisUrl('redis://localhost:6379/1')).toBe(true);
    });

    it('treats a "test" marker in the URL as test-safe', () => {
      expect(isTestSafeRedisUrl('redis://test-redis:6379/0')).toBe(true);
      expect(isTestSafeRedisUrl('redis://localhost:6379/0?ns=test')).toBe(true);
    });

    it('rejects the default localhost URL and DB index 0', () => {
      // Саме сюди зазвичай дивиться дев-застосунок — flushdb тут заборонено.
      expect(isTestSafeRedisUrl('redis://localhost:6379')).toBe(false);
      expect(isTestSafeRedisUrl('redis://localhost:6379/0')).toBe(false);
      expect(isTestSafeRedisUrl('redis://localhost')).toBe(false);
    });

    it('rejects a malformed URL', () => {
      expect(isTestSafeRedisUrl('not-a-url')).toBe(false);
    });
  });

  describe('requireTestRedisUrl', () => {
    it('rejects a missing TEST_REDIS_URL', () => {
      delete process.env.TEST_REDIS_URL;
      expect(() => requireTestRedisUrl()).toThrow(/TEST_REDIS_URL/);
    });

    it('rejects the unsafe default Redis URL (DB 0)', () => {
      process.env.TEST_REDIS_URL = 'redis://localhost:6379';
      expect(() => requireTestRedisUrl()).toThrow(/test-safe/);
    });

    it('accepts and returns a test-safe Redis URL', () => {
      process.env.TEST_REDIS_URL = 'redis://localhost:6379/15';
      expect(requireTestRedisUrl()).toBe('redis://localhost:6379/15');
    });
  });

  describe('requireTestDatabaseUrl', () => {
    it('rejects a missing TEST_DATABASE_URL', () => {
      delete process.env.TEST_DATABASE_URL;
      expect(() => requireTestDatabaseUrl()).toThrow(/TEST_DATABASE_URL/);
    });

    it('rejects a database name without "test"', () => {
      process.env.TEST_DATABASE_URL =
        'postgresql://dev:dev@localhost:5433/secrets_manager';
      expect(() => requireTestDatabaseUrl()).toThrow(/non-test database/);
    });

    it('accepts a test database name', () => {
      const url = 'postgresql://dev:dev@localhost:5433/secrets_manager_test';
      process.env.TEST_DATABASE_URL = url;
      expect(requireTestDatabaseUrl()).toBe(url);
    });
  });

  describe('applyE2EEnv', () => {
    it('forwards the validated test URLs onto DATABASE_URL/REDIS_URL', () => {
      process.env.TEST_DATABASE_URL =
        'postgresql://dev:dev@localhost:5433/secrets_manager_test';
      process.env.TEST_REDIS_URL = 'redis://localhost:6379/15';

      const { databaseUrl, redisUrl } = applyE2EEnv();

      expect(databaseUrl).toBe(process.env.TEST_DATABASE_URL);
      expect(redisUrl).toBe('redis://localhost:6379/15');
      // Застосунок під e2e має піти на тестові інстанси, а не на дефолтну БД 0.
      expect(process.env.DATABASE_URL).toBe(process.env.TEST_DATABASE_URL);
      expect(process.env.REDIS_URL).toBe('redis://localhost:6379/15');
      expect(process.env.REDIS_URL).not.toBe('redis://localhost:6379');
    });

    it('refuses to apply when TEST_REDIS_URL is missing', () => {
      process.env.TEST_DATABASE_URL =
        'postgresql://dev:dev@localhost:5433/secrets_manager_test';
      delete process.env.TEST_REDIS_URL;
      expect(() => applyE2EEnv()).toThrow(/TEST_REDIS_URL/);
    });
  });
});
