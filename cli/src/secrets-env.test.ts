import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSecretEnv, type FetchedSecret } from './secrets-env';

test('buildSecretEnv injects string-valued secrets and skips null/undefined', () => {
  const secrets: FetchedSecret[] = [
    { key: 'API_URL', value: 'https://example.com' },
    { key: 'DB_PASSWORD', value: null }, // немає дозволу reveal
    { key: 'MISSING', value: undefined as unknown as string | null },
    { key: 'EMPTY_OK', value: '' }, // порожній рядок — валідне значення
  ];

  const result = buildSecretEnv(secrets);

  assert.equal(result.injected, 2); // API_URL + EMPTY_OK
  assert.equal(result.skipped, 2); // DB_PASSWORD + MISSING
  assert.equal(result.env.API_URL, 'https://example.com');
  assert.equal(result.env.EMPTY_OK, '');

  // Найважливіше: НЕ інжектимо рядки "null"/"undefined" і взагалі не додаємо ключ.
  assert.ok(!('DB_PASSWORD' in result.env));
  assert.ok(!('MISSING' in result.env));
  assert.notEqual(result.env.DB_PASSWORD, 'null');
  assert.notEqual(result.env.MISSING, 'undefined');
});

test('buildSecretEnv injects every secret when all are revealable', () => {
  const result = buildSecretEnv([
    { key: 'A', value: 'x' },
    { key: 'B', value: 'y' },
  ]);

  assert.equal(result.injected, 2);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.env, { A: 'x', B: 'y' });
});

test('buildSecretEnv on an empty list injects and skips nothing', () => {
  const result = buildSecretEnv([]);
  assert.equal(result.injected, 0);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.env, {});
});
