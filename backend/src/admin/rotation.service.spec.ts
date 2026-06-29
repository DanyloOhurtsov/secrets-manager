import { randomBytes, createCipheriv } from 'node:crypto';
import { RotationService } from './rotation.service';
import {
  CryptoService,
  EncryptionContext,
  SCHEMA_LEGACY,
} from '../crypto/crypto.service';
import { KeyProvider } from '../crypto/key-provider.service';

const KEY_V1 = '11'.repeat(32);
const KEY_V2 = '22'.repeat(32);

function makeProvider(active: string): KeyProvider {
  process.env.MASTER_KEYS = `v1:${KEY_V1},v2:${KEY_V2}`;
  process.env.ACTIVE_KEY_VERSION = active;
  return new KeyProvider();
}

// legacy (schema 1) конверт, загорнутий під master v1, без AAD.
function legacyEnvelope(value: string) {
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
    Buffer.from(KEY_V1, 'hex'),
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
    keyVersion: 'v1',
    encryptionSchemaVersion: SCHEMA_LEGACY,
  };
}

describe('RotationService (AAD-aware rotation)', () => {
  it('rotates both legacy and AAD-protected records and keeps them decryptable', async () => {
    // 1) Записи створено, поки активним був master v1.
    const cryptoV1 = new CryptoService(makeProvider('v1'));

    const ctxA: EncryptionContext = {
      secretId: 'sA',
      secretVersionId: 'vA',
      environmentId: 'envA',
    };
    const v2Row = {
      id: 'vA',
      secretId: 'sA',
      ...cryptoV1.encrypt('aad-value', ctxA),
    };
    const legacyRow = {
      id: 'vB',
      secretId: 'sB',
      ...legacyEnvelope('legacy-value'),
    };

    const rows = [v2Row, legacyRow] as Array<Record<string, unknown>>;
    const byId = new Map(rows.map((r) => [r.id as string, r]));

    // 2) Активним стає master v2 — саме його бачить RotationService.
    const providerV2 = makeProvider('v2');
    const cryptoV2 = new CryptoService(providerV2);

    const prisma = {
      secretVersion: {
        findMany: jest.fn().mockResolvedValue(rows),
        update: jest
          .fn()
          .mockImplementation(
            (args: {
              where: { id: string };
              data: Record<string, unknown>;
            }) => {
              // застосовуємо rewrap до in-memory рядка
              Object.assign(byId.get(args.where.id)!, args.data);
              return Promise.resolve({});
            },
          ),
      },
    };
    const audit = { logRequired: jest.fn().mockResolvedValue(undefined) };

    const rotation = new RotationService(
      prisma as never,
      cryptoV2,
      providerV2,
      audit as never,
    );

    const result = await rotation.rotate('actor-1');

    expect(result.activeVersion).toBe('v2');
    expect(result.rotated).toBe(2);
    expect(result.failed).toEqual([]);

    // Обидва рядки тепер на v2 і досі розшифровуються правильно.
    expect((v2Row as Record<string, unknown>).keyVersion).toBe('v2');
    expect((legacyRow as Record<string, unknown>).keyVersion).toBe('v2');

    expect(cryptoV2.decrypt(v2Row as never, ctxA)).toBe('aad-value');
    // legacy лишається schema 1 → розшифровується без AAD під новим master-ключем.
    expect(
      cryptoV2.decrypt(legacyRow as never, {
        secretId: 'sB',
        secretVersionId: 'vB',
        environmentId: 'envB',
      }),
    ).toBe('legacy-value');

    // Журнал старту/завершення ротації записано.
    expect(audit.logRequired).toHaveBeenCalledTimes(2);
  });
});
