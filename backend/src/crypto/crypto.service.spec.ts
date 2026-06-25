import { randomBytes, createCipheriv } from 'node:crypto';
import { UnprocessableEntityException } from '@nestjs/common';
import {
  CryptoService,
  EncryptionContext,
  SCHEMA_AAD,
  SCHEMA_LEGACY,
} from './crypto.service';
import { KeyProvider } from './key-provider.service';

const KEY_V1 = '11'.repeat(32); // 32-байтовий master-ключ (hex)
const KEY_V2 = '22'.repeat(32);

const ctxA: EncryptionContext = {
  secretId: 'secret-A',
  secretVersionId: 'version-A',
  environmentId: 'env-A',
};
const ctxB: EncryptionContext = {
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

describe('CryptoService (AAD binding)', () => {
  let crypto: CryptoService;

  beforeEach(() => {
    crypto = new CryptoService(makeProvider('v1'));
  });

  it('marks new records with the AAD schema version (2)', () => {
    const enc = crypto.encrypt('s3cr3t', ctxA);
    expect(enc.encryptionSchemaVersion).toBe(SCHEMA_AAD);
    expect(enc.keyVersion).toBe('v1');
  });

  it('v2: decrypts with the correct AAD context', () => {
    const enc = crypto.encrypt('s3cr3t', ctxA);
    expect(crypto.decrypt(enc, ctxA)).toBe('s3cr3t');
  });

  it('v2: fails to decrypt with a wrong AAD context', () => {
    const enc = crypto.encrypt('s3cr3t', ctxA);
    // Кожне поле контексту входить в AAD — підміна будь-якого валить перевірку.
    for (const wrong of [
      { ...ctxA, secretId: 'other' },
      { ...ctxA, secretVersionId: 'other' },
      { ...ctxA, environmentId: 'other' },
    ]) {
      expect(() => crypto.decrypt(enc, wrong)).toThrow(
        UnprocessableEntityException,
      );
    }
  });

  it('v2: tampering with the ciphertext context causes an integrity failure', () => {
    const enc = crypto.encrypt('s3cr3t', ctxA);
    const tampered = { ...enc, ciphertext: Uint8Array.from(enc.ciphertext) };
    tampered.ciphertext[0] ^= 0xff; // фліп біта
    expect(() => crypto.decrypt(tampered, ctxA)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('regression: swapping a whole v2 envelope into another logical slot fails', () => {
    // Імітуємо DB-атаку: рядок A повністю скопійовано у "слот" секрету B.
    // Контекст B не збігається з AAD рядка A → розшифрування падає.
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

    it('rewraps a v2 record across key versions and keeps it decryptable', () => {
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
