import Redis from 'ioredis';

// Перед усім e2e-прогоном чистимо Redis один раз. Rate-limit лічильники мають TTL
// 60с і живуть у спільному Redis, тож залишки попереднього запуску (або іншого
// e2e-файлу) інакше зливалися б в одне вікно й давали хибні 429 на signup/login.
// Кожен e2e-файл стартує з детермінованим, чистим вікном лімітів.
export default async function globalSetup(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  try {
    await redis.flushdb();
  } finally {
    await redis.quit();
  }
}
