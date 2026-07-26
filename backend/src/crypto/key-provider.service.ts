import { Injectable } from '@nestjs/common';

// Ця підказка додається до КОЖНОЇ помилки конфігурації ключів. KeyProvider падає
// в конструкторі — тобто ще до того, як Nest добудує граф модулів і Express займе
// порт. Логи процесу є єдиним місцем, де оператор побачить причину (в Kubernetes
// це CrashLoopBackOff без жодної активності проб), тож помилка без інструкції
// «як це полагодити» там марна.
const HOWTO = [
  'Generate a key with:  echo "v1:$(openssl rand -hex 32)"',
  'Format: comma-separated version:hex entries, each value exactly 64 hex',
  'characters — e.g. MASTER_KEYS="v1:<64 hex>,v2:<64 hex>".',
].join('\n  ');

// Рівно 32 байти в hex. Формат перевіряємо ДО Buffer.from: той мовчки обрізає
// рядок на першому невалідному символі, тож без цієї регулярки одруківка
// виглядає як помилка довжини ("got 0 bytes"), а "<64 hex>zz" не помічається
// взагалі — ключ приймається, а зайві символи просто ігноруються.
const HEX_64 = /^[0-9a-f]{64}$/i;

@Injectable()
export class KeyProvider {
  private readonly keys = new Map<string, Buffer>();
  private readonly activeVersion: string;

  // Жодне повідомлення нижче не містить самого hex — це майстер-ключ, а текст
  // помилки потрапляє в логи. Друкуємо лише мітку версії та довжину.
  constructor() {
    const raw = process.env.MASTER_KEYS?.trim();
    if (!raw) {
      throw new Error(`MASTER_KEYS is not set.\n  ${HOWTO}`);
    }

    raw.split(',').forEach((entry, index) => {
      const at = `MASTER_KEYS entry #${index + 1}`;

      // indexOf, а не split(':'): усе після ПЕРШОЇ двокрапки — це hex. Інакше
      // "v1:aa:bb" тихо втрачає хвіст і звітує про неправильну довжину.
      const separator = entry.indexOf(':');
      if (separator === -1) {
        throw new Error(`${at} is missing the "version:" prefix.\n  ${HOWTO}`);
      }

      const version = entry.slice(0, separator).trim();
      const hex = entry.slice(separator + 1).trim();

      if (!version) {
        throw new Error(`${at} has an empty version label.\n  ${HOWTO}`);
      }

      // Раніше Map.set просто перезаписував: із двох однакових версій вигравала
      // остання, і ротація тихо працювала не тим ключем, який очікував оператор.
      if (this.keys.has(version)) {
        throw new Error(
          `${at} redefines version "${version}", which is already set. ` +
            'Each version may appear only once in MASTER_KEYS.',
        );
      }

      if (!HEX_64.test(hex)) {
        throw new Error(
          `${at} ("${version}") must be exactly 64 hex characters ` +
            `(got ${hex.length}).\n  ${HOWTO}`,
        );
      }

      this.keys.set(version, Buffer.from(hex, 'hex'));
    });

    // Версії в мапі збережені обрізаними, тож обрізаємо і тут: інакше
    // ACTIVE_KEY_VERSION=" v1" звітує "unknown" при цілком завантаженому v1.
    const active = process.env.ACTIVE_KEY_VERSION?.trim();
    const loaded = [...this.keys.keys()].join(', ');

    if (!active) {
      throw new Error(
        `ACTIVE_KEY_VERSION is not set. Set it to one of the versions in ` +
          `MASTER_KEYS: ${loaded}.`,
      );
    }
    if (!this.keys.has(active)) {
      throw new Error(
        `ACTIVE_KEY_VERSION "${active}" has no matching entry in MASTER_KEYS. ` +
          `Loaded versions: ${loaded}.`,
      );
    }

    this.activeVersion = active;
  }

  getActiveVersion(): string {
    return this.activeVersion;
  }

  getKey(version: string): Buffer {
    const key = this.keys.get(version);
    if (!key) {
      throw new Error(`No master key for version ${version}`);
    }
    return key;
  }
}
