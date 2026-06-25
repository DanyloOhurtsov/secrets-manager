import { randomBytes, createCipheriv } from 'node:crypto';
import {
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CryptoService,
  EncryptionContext,
  SCHEMA_AAD,
  SCHEMA_AAD_ORG,
  SCHEMA_LEGACY,
} from './crypto.service';
import { KeyProvider } from './key-provider.service';

const KEY_V1 = '11'.repeat(32); // 32-байтовий master-ключ (hex) — лише для тестів
const KEY_V2 = '22'.repeat(32);

// Два логічні слоти в РІЗНИХ організаціях — щоб довести тенант-привʼязку AAD.
const ctxA: EncryptionContext = {
  organizationId: 'org-A',
  secretId: 'secret-A',
  secretVersionId: 'version-A',
  environmentId: 'env-A',
};
const ctxB: EncryptionContext = {
  organizationId: 'org-B',
  secretId: 'secret-B',
  secretVersionId: 'version-B',
  environmentId: 'env-B',
};

function makeProvider(active: string): KeyProvider {
  process.env.MASTER_KEYS = `v1:${KEY_V1},v2:${KEY_V2}`;
  process.env.ACTIVE_KEY_VERSION = active;
  return new KeyProvider();
}

// Будуємо legacy-конверт (schema 1, БЕЗ AAD) вручну тим самим master-ключем,
// що його бачить KeyProvider — щоб довести: історичні записи й далі читаються.
function legacyEnvelope(masterHex: string, keyVersion: string, value: string) {
  const dataKey = randomBytes(32);

  const valueIv = randomBytes(12);
  const vCipher = createCipheriv('aes-256-gcm', dataKey, valueIv);
  const ciphertext = Buffer.concat([
    vCipher.update(Buffer.from(value, 'utf-8')),
    vCipher.final(),
  ]);
  const valueAuthTag = vCipher.getAuthTag();

  const dataKeyIv = randomBytes(12);
  const kCipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(masterHex, 'hex'),
    dataKeyIv,
  );
  const encryptedDataKey = Buffer.concat([
    kCipher.update(dataKey),
    kCipher.final(),
  ]);
  const dataKeyAuthTag = kCipher.getAuthTag();

  return {
    ciphertext,
    valueIv,
    valueAuthTag,
    encryptedDataKey,
    dataKeyIv,
    dataKeyAuthTag,
    keyVersion,
    encryptionSchemaVersion: SCHEMA_LEGACY,
  };
}

// Будуємо ІСТОРИЧНИЙ schema-2 конверт (AAD без organizationId) тим самим
// форматом AAD, що його очікує CryptoService — щоб довести зворотну сумісність:
// старі записи й далі читаються після переходу на schema 3.
function v2Envelope(
  masterHex: string,
  keyVersion: string,
  value: string,
  ctx: EncryptionContext,
) {
  const dataKey = randomBytes(32);

  const valueAad = Buffer.from(
    `secret-value:v2:${ctx.secretId}:${ctx.secretVersionId}:${ctx.environmentId}`,
    'utf-8',
  );
  const valueIv = randomBytes(12);
  const vCipher = createCipheriv('aes-256-gcm', dataKey, valueIv);
  vCipher.setAAD(valueAad);
  const ciphertext = Buffer.concat([
    vCipher.update(Buffer.from(value, 'utf-8')),
    vCipher.final(),
  ]);
  const valueAuthTag = vCipher.getAuthTag();

  const dataKeyAad = Buffer.from(
    `data-key:v2:${ctx.secretId}:${ctx.secretVersionId}:${keyVersion}`,
    'utf-8',
  );
  const dataKeyIv = randomBytes(12);
  const kCipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(masterHex, 'hex'),
    dataKeyIv,
  );
  kCipher.setAAD(dataKeyAad);
  const encryptedDataKey = Buffer.concat([
    kCipher.update(dataKey),
    kCipher.final(),
  ]);
  const dataKeyAuthTag = kCipher.getAuthTag();

  return {
    ciphertext,
    valueIv,
    valueAuthTag,
    encryptedDataKey,
    dataKeyIv,
    dataKeyAuthTag,
    keyVersion,
    encryptionSchemaVersion: SCHEMA_AAD,
  };
}

describe('CryptoService (AAD binding)', () => {
  let crypto: CryptoService;

  beforeEach(() => {
    crypto = new CryptoService(makeProvider('v1'));
  });

  it('marks new records with the AAD+org schema version (3)', () => {
    const enc = crypto.encrypt('s3cr3t', ctxA);
    expect(enc.encryptionSchemaVersion).toBe(SCHEMA_AAD_ORG);
    expect(enc.keyVersion).toBe('v1');
  });

  it('v3: decrypts with the correct AAD context', () => {
    const enc = crypto.encrypt('s3cr3t', ctxA);
    expect(crypto.decrypt(enc, ctxA)).toBe('s3cr3t');
  });

  it('v3: fails to decrypt with a wrong AAD context', () => {
    const enc = crypto.encrypt('s3cr3t', ctxA);
    // Кожне поле контексту входить в AAD — підміна будь-якого валить перевірку.
    for (const wrong of [
      { ...ctxA, organizationId: 'other' },
      { ...ctxA, secretId: 'other' },
      { ...ctxA, secretVersionId: 'other' },
      { ...ctxA, environmentId: 'other' },
    ]) {
      expect(() => crypto.decrypt(enc, wrong)).toThrow(
        UnprocessableEntityException,
      );
    }
  });

  it('v3: rejects ciphertext when only the organizationId differs (tenant binding)', () => {
    // Найтонший випадок: усе інше збігається, відрізняється лише тенант. Саме це
    // ловить підміну зашифрованого значення між організаціями в БД.
    const enc = crypto.encrypt('cross-tenant', ctxA);
    expect(() =>
      crypto.decrypt(enc, { ...ctxA, organizationId: 'org-evil' }),
    ).toThrow(UnprocessableEntityException);
  });

  it('v3: tampering with the ciphertext causes an integrity failure', () => {
    const enc = crypto.encrypt('s3cr3t', ctxA);
    const tampered = { ...enc, ciphertext: Uint8Array.from(enc.ciphertext) };
    tampered.ciphertext[0] ^= 0xff; // фліп біта
    expect(() => crypto.decrypt(tampered, ctxA)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('v3: tampering with the value auth tag fails', () => {
    const enc = crypto.encrypt('s3cr3t', ctxA);
    const tampered = {
      ...enc,
      valueAuthTag: Uint8Array.from(enc.valueAuthTag),
    };
    tampered.valueAuthTag[0] ^= 0xff;
    expect(() => crypto.decrypt(tampered, ctxA)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('v3: tampering with the value IV/nonce fails', () => {
    const enc = crypto.encrypt('s3cr3t', ctxA);
    const tampered = { ...enc, valueIv: Uint8Array.from(enc.valueIv) };
    tampered.valueIv[0] ^= 0xff;
    expect(() => crypto.decrypt(tampered, ctxA)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('treats an unknown master key version as a server error, not a 422 integrity failure', () => {
    // Конфігурація сервера (нема такого master-ключа) != підміна/корупція даних.
    const enc = crypto.encrypt('s3cr3t', ctxA);
    let caught: unknown;
    try {
      crypto.decrypt({ ...enc, keyVersion: 'v-unknown' }, ctxA);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InternalServerErrorException);
    expect(caught).not.toBeInstanceOf(UnprocessableEntityException);
    // Загальне повідомлення — без keyVersion/ключів.
    expect((caught as Error).message).not.toContain('v-unknown');
  });

  it('regression: swapping a whole v3 envelope into another logical slot fails', () => {
    // Імітуємо DB-атаку: рядок A повністю скопійовано у "слот" секрету B
    // (інша org/secret/version/env). Контекст B не збігається з AAD рядка A →
    // розшифрування падає — не через authz, а через автентифіковане шифрування.
    const envA = crypto.encrypt('value-A', ctxA);
    expect(crypto.decrypt(envA, ctxA)).toBe('value-A'); // контроль
    expect(() => crypto.decrypt(envA, ctxB)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('legacy v1: still decrypts without AAD', () => {
    const legacy = legacyEnvelope(KEY_V1, 'v1', 'legacy-value');
    // Контекст передаємо, але для schema 1 він ігнорується (AAD не застосовується).
    expect(crypto.decrypt(legacy, ctxA)).toBe('legacy-value');
  });

  it('v2 (historical): still decrypts with its schema-2 AAD context', () => {
    // Зворотна сумісність: записи, зашифровані до введення org-привʼязки (schema 2),
    // лишаються читабельними під schema 3 кодом.
    const v2 = v2Envelope(KEY_V1, 'v1', 'historical-value', ctxA);
    expect(crypto.decrypt(v2, ctxA)).toBe('historical-value');
  });

  it('v2 (historical): is NOT tenant-bound — decrypts even if organizationId differs', () => {
    // Документує причину переходу на schema 3: AAD schema-2 не містить org, тож
    // підміна тенанта НЕ ловиться. Нові записи (schema 3) цю діру закривають.
    const v2 = v2Envelope(KEY_V1, 'v1', 'historical-value', ctxA);
    expect(crypto.decrypt(v2, { ...ctxA, organizationId: 'org-other' })).toBe(
      'historical-value',
    );
  });

  describe('rewrapDataKey', () => {
    it('returns null when already on the active key version', () => {
      const enc = crypto.encrypt('x', ctxA); // keyVersion = active 'v1'
      expect(
        crypto.rewrapDataKey(enc, {
          secretId: ctxA.secretId,
          secretVersionId: ctxA.secretVersionId,
        }),
      ).toBeNull();
    });

    it('rewraps a v3 record across key versions and keeps it decryptable', () => {
      const cryptoV2 = new CryptoService(makeProvider('v2'));
      const onV1 = crypto.encrypt('rotate-me', ctxA); // wrapped under v1

      const rewrapped = cryptoV2.rewrapDataKey(onV1, {
        secretId: ctxA.secretId,
        secretVersionId: ctxA.secretVersionId,
      });
      expect(rewrapped).not.toBeNull();
      expect(rewrapped!.keyVersion).toBe('v2');

      // value-конверт не зачеплено, лише data-key переприв'язано до v2.
      expect(cryptoV2.decrypt({ ...onV1, ...rewrapped! }, ctxA)).toBe(
        'rotate-me',
      );
    });

    it('rewraps a legacy v1 record without AAD and keeps it decryptable', () => {
      const cryptoV2 = new CryptoService(makeProvider('v2'));
      const legacy = legacyEnvelope(KEY_V1, 'v1', 'legacy-rotate');

      const rewrapped = cryptoV2.rewrapDataKey(legacy, {
        secretId: 'whatever',
        secretVersionId: 'whatever',
      });
      expect(rewrapped!.keyVersion).toBe('v2');
      // Лишається legacy (schema 1) — розшифровується без AAD під новим master-ключем.
      expect(cryptoV2.decrypt({ ...legacy, ...rewrapped! }, ctxA)).toBe(
        'legacy-rotate',
      );
    });
  });
});
