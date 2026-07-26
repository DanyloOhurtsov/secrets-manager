import { KeyProvider } from './key-provider.service';

const KEY_V1 = '11'.repeat(32); // 64 hex-символи — лише для тестів
const KEY_V2 = '22'.repeat(32);

// KeyProvider читає process.env у конструкторі, а process.env спільний на весь
// файл. Знімаємо копію до кожного тесту й відновлюємо після — інакше тести
// протікають один в одного (саме цього бракує makeProvider у crypto.service.spec).
let envBackup: NodeJS.ProcessEnv;

beforeEach(() => {
  envBackup = { ...process.env };
});

afterEach(() => {
  process.env = envBackup;
});

function load(masterKeys?: string, activeVersion?: string): () => KeyProvider {
  if (masterKeys === undefined) delete process.env.MASTER_KEYS;
  else process.env.MASTER_KEYS = masterKeys;

  if (activeVersion === undefined) delete process.env.ACTIVE_KEY_VERSION;
  else process.env.ACTIVE_KEY_VERSION = activeVersion;

  return () => new KeyProvider();
}

describe('KeyProvider', () => {
  describe('valid configuration', () => {
    it('loads a single key and reports the active version', () => {
      const provider = load(`v1:${KEY_V1}`, 'v1')();

      expect(provider.getActiveVersion()).toBe('v1');
      expect(provider.getKey('v1')).toEqual(Buffer.from(KEY_V1, 'hex'));
      expect(provider.getKey('v1')).toHaveLength(32);
    });

    it('loads several versions and keeps the non-active ones readable', () => {
      // Ротація: старі секрети лишаються на v1, нові пишуться під v2.
      const provider = load(`v1:${KEY_V1},v2:${KEY_V2}`, 'v2')();

      expect(provider.getActiveVersion()).toBe('v2');
      expect(provider.getKey('v1')).toEqual(Buffer.from(KEY_V1, 'hex'));
      expect(provider.getKey('v2')).toEqual(Buffer.from(KEY_V2, 'hex'));
    });

    it('tolerates whitespace around entries and around the active version', () => {
      const provider = load(` v1 : ${KEY_V1} , v2 : ${KEY_V2} `, ' v2 ')();

      expect(provider.getActiveVersion()).toBe('v2');
      expect(provider.getKey('v1')).toHaveLength(32);
    });

    it('accepts uppercase hex', () => {
      const provider = load(`v1:${KEY_V1.toUpperCase()}`, 'v1')();

      expect(provider.getKey('v1')).toEqual(Buffer.from(KEY_V1, 'hex'));
    });

    it('throws for a version that was never loaded', () => {
      const provider = load(`v1:${KEY_V1}`, 'v1')();

      expect(() => provider.getKey('v9')).toThrow(
        'No master key for version v9',
      );
    });
  });

  describe('MASTER_KEYS is unusable', () => {
    it('refuses to start when unset', () => {
      expect(load(undefined, 'v1')).toThrow('MASTER_KEYS is not set');
    });

    it('refuses to start when empty', () => {
      expect(load('', 'v1')).toThrow('MASTER_KEYS is not set');
    });

    it('refuses to start when whitespace-only', () => {
      expect(load('   ', 'v1')).toThrow('MASTER_KEYS is not set');
    });

    it('rejects an entry with no "version:" prefix', () => {
      expect(load(KEY_V1, 'v1')).toThrow(
        'MASTER_KEYS entry #1 is missing the "version:" prefix',
      );
    });

    it('names the offending entry by position', () => {
      expect(load(`v1:${KEY_V1},${KEY_V2}`, 'v1')).toThrow(
        'MASTER_KEYS entry #2 is missing the "version:" prefix',
      );
    });

    it('rejects a trailing comma', () => {
      expect(load(`v1:${KEY_V1},`, 'v1')).toThrow('MASTER_KEYS entry #2');
    });

    it('rejects an empty version label', () => {
      expect(load(`:${KEY_V1}`, 'v1')).toThrow(
        'MASTER_KEYS entry #1 has an empty version label',
      );
    });

    it('rejects a key that is too short', () => {
      expect(load(`v1:${'11'.repeat(31)}`, 'v1')).toThrow(
        'must be exactly 64 hex characters (got 62)',
      );
    });

    it('rejects a key that is too long', () => {
      expect(load(`v1:${'11'.repeat(33)}`, 'v1')).toThrow(
        'must be exactly 64 hex characters (got 66)',
      );
    });

    // Регресія: Buffer.from(hex, 'hex') обрізає рядок на першому невалідному
    // символі. Без явної перевірки формату одруківка звітувала як помилка
    // ДОВЖИНИ ("got 10 bytes"), що відправляло оператора шукати не там.
    it('rejects non-hex characters instead of reporting a length problem', () => {
      const typo = `${'11'.repeat(10)}zz${'11'.repeat(21)}`; // 64 символи, два невалідні

      expect(typo).toHaveLength(64);
      expect(load(`v1:${typo}`, 'v1')).toThrow(
        'must be exactly 64 hex characters (got 64)',
      );
    });

    // Регресія: 64 валідні hex-символи + сміття раніше проходили МОВЧКИ —
    // Buffer зупинявся на 64-му символі й довжина сходилась.
    it('rejects trailing garbage after 64 valid hex characters', () => {
      expect(load(`v1:${KEY_V1}zz`, 'v1')).toThrow(
        'must be exactly 64 hex characters (got 66)',
      );
    });

    // Регресія: Map.set просто перезаписував — вигравала остання копія, і
    // ротація тихо працювала не тим ключем, який очікував оператор.
    it('rejects a duplicate version instead of silently keeping the last', () => {
      expect(load(`v1:${KEY_V1},v1:${KEY_V2}`, 'v1')).toThrow(
        'redefines version "v1"',
      );
    });

    // Текст помилки йде в логи контейнера. Довжина — так, сам ключ — ніколи.
    it('never puts key material in the error message', () => {
      expect.assertions(2);

      try {
        load(`v1:${KEY_V1}zz`, 'v1')();
      } catch (e) {
        expect((e as Error).message).toContain('64 hex characters');
        expect((e as Error).message).not.toContain(KEY_V1);
      }
    });

    it('tells the operator how to generate a key', () => {
      expect(load(undefined, 'v1')).toThrow('openssl rand -hex 32');
      expect(load(`v1:${'11'.repeat(31)}`, 'v1')).toThrow(
        'openssl rand -hex 32',
      );
    });
  });

  describe('ACTIVE_KEY_VERSION is unusable', () => {
    it('refuses to start when unset, and lists what was loaded', () => {
      expect(load(`v1:${KEY_V1},v2:${KEY_V2}`, undefined)).toThrow(
        'ACTIVE_KEY_VERSION is not set',
      );
      expect(load(`v1:${KEY_V1},v2:${KEY_V2}`, undefined)).toThrow('v1, v2');
    });

    it('refuses to start when empty', () => {
      expect(load(`v1:${KEY_V1}`, '')).toThrow('ACTIVE_KEY_VERSION is not set');
    });

    it('refuses to start when it names a version that was not loaded', () => {
      expect(load(`v1:${KEY_V1}`, 'v2')).toThrow(
        'ACTIVE_KEY_VERSION "v2" has no matching entry in MASTER_KEYS',
      );
      expect(load(`v1:${KEY_V1}`, 'v2')).toThrow('Loaded versions: v1');
    });
  });
});
