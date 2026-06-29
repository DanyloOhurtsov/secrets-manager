import { Injectable } from '@nestjs/common';

@Injectable()
export class KeyProvider {
  private readonly keys: Map<string, Buffer> = new Map();
  private readonly activeVersion: string;

  constructor() {
    const raw = process.env.MASTER_KEYS;
    if (!raw) {
      throw new Error('MASTER_KEYS is not configured');
    }

    for (const entry of raw.split(',')) {
      const [version, hex] = entry.split(':');
      if (!version || !hex) {
        throw new Error(`Invalid MASTER_KEYS entry`);
      }
      const key = Buffer.from(hex.trim(), 'hex');
      if (key.length !== 32) {
        throw new Error(
          `Master key ${version} must be 32 bytes (got ${key.length})`,
        );
      }
      this.keys.set(version.trim(), key);
    }

    const active = process.env.ACTIVE_KEY_VERSION;
    if (!active || !this.keys.has(active)) {
      throw new Error('ACTIVE_KEY_VERSION is missing or unknown');
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
