// Безпечне середовище для e2e: ці тести ВИТИРАЮТЬ дані — і Postgres (десятки
// deleteMany), і Redis (flushdb). Щоб випадковий запуск не зніс дев/спільний
// інстанс, вимагаємо ЯВНІ test-URL і відмовляємось працювати, якщо їх немає або
// вони не виглядають як тестові. Postgres уже має такий гард (ім'я БД містить
// "test"); тут додаємо симетричний гард для Redis.

// Назва БД у TEST_DATABASE_URL має містити "test" — інакше відмовляємось чистити.
export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'Refusing to run e2e tests without TEST_DATABASE_URL. These tests clean the database.',
    );
  }

  const databaseName = new URL(url).pathname.replace(/^\//, '');
  if (!databaseName.includes('test')) {
    throw new Error(
      `Refusing to run e2e tests against non-test database "${databaseName}".`,
    );
  }

  return url;
}

// Redis-URL вважаємо test-safe, якщо він вказує на НЕнульовий індекс БД
// (redis://host:port/<n>, n != 0) АБО містить "test" у host/path/query. Так
// flushdb б'є по виділеній тестовій БД, а не по дефолтній (індекс 0), куди
// зазвичай дивиться дев-застосунок. Консервативно: усе інше — не test-safe.
export function isTestSafeRedisUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  const haystack =
    `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
  if (haystack.includes('test')) return true;

  // Індекс БД — перший сегмент шляху (redis://host:port/<db>).
  const dbSegment = parsed.pathname.replace(/^\//, '').split('/')[0];
  const dbIndex = Number.parseInt(dbSegment, 10);
  return Number.isInteger(dbIndex) && dbIndex !== 0;
}

// Жодного фолбеку на redis://localhost:6379 для e2e: відсутній або не-test-safe
// URL означає відмову (fail-closed), а не тихе підключення до дефолтної БД.
export function requireTestRedisUrl(): string {
  const url = process.env.TEST_REDIS_URL;
  if (!url) {
    throw new Error(
      'Refusing to run e2e tests without TEST_REDIS_URL. These tests flush Redis. ' +
        'Point it at a dedicated test Redis, e.g. redis://localhost:6379/15.',
    );
  }

  if (!isTestSafeRedisUrl(url)) {
    throw new Error(
      `Refusing to flush a Redis URL that does not look test-safe ("${url}"). ` +
        'Use a non-zero DB index (e.g. /15) or include "test" in the URL.',
    );
  }

  return url;
}

// Прокидаємо валідовані URL у process.env ПЕРЕД компіляцією AppModule, щоб і
// Prisma, і Nest-застосунок (кеш + rate-limit на Redis) під e2e дивились саме
// на тестові інстанси, а не на дефолтні DATABASE_URL/REDIS_URL із .env.
export function applyE2EEnv(): { databaseUrl: string; redisUrl: string } {
  const databaseUrl = requireTestDatabaseUrl();
  const redisUrl = requireTestRedisUrl();
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  return { databaseUrl, redisUrl };
}
