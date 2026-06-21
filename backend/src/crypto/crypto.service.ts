import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { KeyProvider } from './key-provider.service';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const DATA_KEY_LENGTH = 32;

export interface EncryptedSecret {
  ciphertext: Uint8Array<ArrayBuffer>;
  valueIv: Uint8Array<ArrayBuffer>;
  valueAuthTag: Uint8Array<ArrayBuffer>;
  encryptedDataKey: Uint8Array<ArrayBuffer>;
  dataKeyIv: Uint8Array<ArrayBuffer>;
  dataKeyAuthTag: Uint8Array<ArrayBuffer>;
  keyVersion: string;
}

// Результат перепакування data-key (значення секрету не зачіпається)
export interface RewrappedDataKey {
  encryptedDataKey: Uint8Array<ArrayBuffer>;
  dataKeyIv: Uint8Array<ArrayBuffer>;
  dataKeyAuthTag: Uint8Array<ArrayBuffer>;
  keyVersion: string;
}

function toBytes(input: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(input.length);
  out.set(input);
  return out as Uint8Array<ArrayBuffer>;
}

@Injectable()
export class CryptoService {
  constructor(private readonly keyProvider: KeyProvider) {}

  private encryptWithKey(key: Buffer, plaintext: Buffer) {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { ciphertext, iv, authTag };
  }

  private decryptWithKey(
    key: Buffer,
    ciphertext: Uint8Array,
    iv: Uint8Array,
    authTag: Uint8Array,
  ): Buffer {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext)),
      decipher.final(),
    ]);
  }

  encrypt(value: string): EncryptedSecret {
    const dataKey = randomBytes(DATA_KEY_LENGTH);
    const valueEnc = this.encryptWithKey(dataKey, Buffer.from(value, 'utf-8'));

    const version = this.keyProvider.getActiveVersion();
    const masterKey = this.keyProvider.getKey(version);
    const dataKeyEnc = this.encryptWithKey(masterKey, dataKey);

    return {
      ciphertext: toBytes(valueEnc.ciphertext),
      valueIv: toBytes(valueEnc.iv),
      valueAuthTag: toBytes(valueEnc.authTag),
      encryptedDataKey: toBytes(dataKeyEnc.ciphertext),
      dataKeyIv: toBytes(dataKeyEnc.iv),
      dataKeyAuthTag: toBytes(dataKeyEnc.authTag),
      keyVersion: version,
    };
  }

  decrypt(data: {
    ciphertext: Uint8Array;
    valueIv: Uint8Array;
    valueAuthTag: Uint8Array;
    encryptedDataKey: Uint8Array;
    dataKeyIv: Uint8Array;
    dataKeyAuthTag: Uint8Array;
    keyVersion: string;
  }): string {
    try {
      const masterKey = this.keyProvider.getKey(data.keyVersion);

      const dataKey = this.decryptWithKey(
        masterKey,
        data.encryptedDataKey,
        data.dataKeyIv,
        data.dataKeyAuthTag,
      );

      const plaintext = this.decryptWithKey(
        dataKey,
        data.ciphertext,
        data.valueIv,
        data.valueAuthTag,
      );

      return plaintext.toString('utf-8');
    } catch {
      throw new UnprocessableEntityException(
        'Secret integrity check failed — data may be corrupted or tampered with',
      );
    }
  }

  /**
   * Перепаковує data-key зі старої версії master-ключа в активну.
   * Значення секрету (ciphertext) НЕ зачіпається — лише "конверт" навколо data-key.
   * Якщо секрет уже на активній версії — повертає null (нема що робити).
   */
  rewrapDataKey(data: {
    encryptedDataKey: Uint8Array;
    dataKeyIv: Uint8Array;
    dataKeyAuthTag: Uint8Array;
    keyVersion: string;
  }): RewrappedDataKey | null {
    const activeVersion = this.keyProvider.getActiveVersion();
    if (data.keyVersion === activeVersion) {
      return null; // вже на активній версії
    }

    // 1. Розшифровуємо data-key старим master-ключем
    const oldMasterKey = this.keyProvider.getKey(data.keyVersion);
    const dataKey = this.decryptWithKey(
      oldMasterKey,
      data.encryptedDataKey,
      data.dataKeyIv,
      data.dataKeyAuthTag,
    );

    // 2. Перешифровуємо data-key новим (активним) master-ключем
    const newMasterKey = this.keyProvider.getKey(activeVersion);
    const reEnc = this.encryptWithKey(newMasterKey, dataKey);

    return {
      encryptedDataKey: toBytes(reEnc.ciphertext),
      dataKeyIv: toBytes(reEnc.iv),
      dataKeyAuthTag: toBytes(reEnc.authTag),
      keyVersion: activeVersion,
    };
  }
}
