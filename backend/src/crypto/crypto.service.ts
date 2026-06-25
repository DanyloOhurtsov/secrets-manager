import {
  Injectable,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { KeyProvider } from './key-provider.service';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const DATA_KEY_LENGTH = 32;

// Версії схеми шифрування рядка SecretVersion.
export const SCHEMA_LEGACY = 1; // AES-GCM без AAD (історичні записи)
export const SCHEMA_AAD = 2; // value привʼязано до secret/version/env (без org)
export const SCHEMA_AAD_ORG = 3; // value привʼязано до ORG + secret/version/env

// Схема, якою шифруються всі НОВІ записи. Тенант (organizationId) тепер входить
// в AAD значення — крадіжка ciphertext у БД між організаціями не розшифрується,
// навіть якщо рядок підмінити цілком (тенант-контекст не збігається).
export const SCHEMA_CURRENT = SCHEMA_AAD_ORG;

// Стабільний, не-секретний контекст версії секрету. Лише незмінні метадані —
// з них детерміновано будується AAD. Жодного плейнтексту, ключів чи токенів.
export interface EncryptionContext {
  organizationId: string;
  secretId: string;
  secretVersionId: string;
  environmentId: string;
}

export interface EncryptedSecret {
  ciphertext: Uint8Array<ArrayBuffer>;
  valueIv: Uint8Array<ArrayBuffer>;
  valueAuthTag: Uint8Array<ArrayBuffer>;
  encryptedDataKey: Uint8Array<ArrayBuffer>;
  dataKeyIv: Uint8Array<ArrayBuffer>;
  dataKeyAuthTag: Uint8Array<ArrayBuffer>;
  keyVersion: string;
  encryptionSchemaVersion: number;
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
  return out;
}

@Injectable()
export class CryptoService {
  constructor(private readonly keyProvider: KeyProvider) {}

  // --- Побудова AAD (єдине місце, щоб формат не дублювався) ---------------
  // AAD прив'язує конверт до логічного контексту в БД. Формат версіонований і
  // детермінований; кожна схема має власний неоднозначно розділений рядок, щоб
  // конверт не можна було «перечитати» в іншому контексті. Для legacy (schema 1)
  // AAD не використовується взагалі, тож повертаємо undefined.

  // AAD значення секрету. v3 додає organizationId — тенант-привʼязка ciphertext.
  private valueAad(
    schemaVersion: number,
    ctx: EncryptionContext,
  ): Buffer | undefined {
    // v3 — повний тенант-контекст: org + secret + version + environment.
    if (schemaVersion === SCHEMA_AAD_ORG) {
      return Buffer.from(
        `secrets-manager:v3:org:${ctx.organizationId}:secret:${ctx.secretId}:version:${ctx.secretVersionId}:env:${ctx.environmentId}`,
        'utf-8',
      );
    }
    // v2 — історичний формат без org; лишаємо читабельним для старих записів.
    if (schemaVersion === SCHEMA_AAD) {
      return Buffer.from(
        `secret-value:v2:${ctx.secretId}:${ctx.secretVersionId}:${ctx.environmentId}`,
        'utf-8',
      );
    }
    return undefined; // legacy (schema 1) — без AAD
  }

  // AAD «конверта» навколо data-key. Формат СПІЛЬНИЙ для v2 і v3 і навмисно НЕ
  // містить organizationId: перепакування ключів під час ротації (rewrapDataKey)
  // оперує лише стабільними secretId/versionId, без тенант-контексту. Тенант-
  // привʼязку забезпечує valueAad на самому значенні секрету (v3). Legacy — без AAD.
  private dataKeyAad(
    schemaVersion: number,
    ctx: { secretId: string; secretVersionId: string },
    keyVersion: string,
  ): Buffer | undefined {
    if (schemaVersion === SCHEMA_LEGACY) return undefined;
    return Buffer.from(
      `data-key:v2:${ctx.secretId}:${ctx.secretVersionId}:${keyVersion}`,
      'utf-8',
    );
  }

  private encryptWithKey(key: Buffer, plaintext: Buffer, aad?: Buffer) {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    if (aad) cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return { ciphertext, iv, authTag };
  }

  private decryptWithKey(
    key: Buffer,
    ciphertext: Uint8Array,
    iv: Uint8Array,
    authTag: Uint8Array,
    aad?: Buffer,
  ): Buffer {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    if (aad) decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext)),
      decipher.final(),
    ]);
  }

  // Нове шифрування завжди використовує AAD з тенант-контекстом (schema 3).
  // Контекст обовʼязковий — він фіксує, до якої організації/секрету/версії/
  // оточення належить конверт. organizationId входить в AAD значення.
  encrypt(value: string, context: EncryptionContext): EncryptedSecret {
    const keyVersion = this.keyProvider.getActiveVersion();
    const masterKey = this.keyProvider.getKey(keyVersion);

    const dataKey = randomBytes(DATA_KEY_LENGTH);
    const valueEnc = this.encryptWithKey(
      dataKey,
      Buffer.from(value, 'utf-8'),
      this.valueAad(SCHEMA_CURRENT, context),
    );

    const dataKeyEnc = this.encryptWithKey(
      masterKey,
      dataKey,
      this.dataKeyAad(SCHEMA_CURRENT, context, keyVersion),
    );

    return {
      ciphertext: toBytes(valueEnc.ciphertext),
      valueIv: toBytes(valueEnc.iv),
      valueAuthTag: toBytes(valueEnc.authTag),
      encryptedDataKey: toBytes(dataKeyEnc.ciphertext),
      dataKeyIv: toBytes(dataKeyEnc.iv),
      dataKeyAuthTag: toBytes(dataKeyEnc.authTag),
      keyVersion,
      encryptionSchemaVersion: SCHEMA_CURRENT,
    };
  }

  // Розшифрування гілкується за encryptionSchemaVersion:
  //   1 (legacy)  — без AAD, context ігнорується (старі записи лишаються читабельними);
  //   2 (AAD)     — data-key і значення перевіряються з AAD без organizationId;
  //   3 (AAD+org) — те саме, але AAD значення додатково містить organizationId
  //                 (підміна ciphertext між тенантами → integrity-failure).
  decrypt(
    data: {
      ciphertext: Uint8Array;
      valueIv: Uint8Array;
      valueAuthTag: Uint8Array;
      encryptedDataKey: Uint8Array;
      dataKeyIv: Uint8Array;
      dataKeyAuthTag: Uint8Array;
      keyVersion: string;
      encryptionSchemaVersion: number;
    },
    context: EncryptionContext,
  ): string {
    // Відсутній/невідомий master-ключ — це збій конфігурації сервера, а НЕ
    // підміна даних. Тримаємо його ПОЗА GCM-catch, щоб не маскувати під 422.
    // Повідомлення навмисно загальне — без keyVersion, ключів і stack.
    let masterKey: Buffer;
    try {
      masterKey = this.keyProvider.getKey(data.keyVersion);
    } catch {
      throw new InternalServerErrorException('Encryption key unavailable');
    }

    try {
      const dataKey = this.decryptWithKey(
        masterKey,
        data.encryptedDataKey,
        data.dataKeyIv,
        data.dataKeyAuthTag,
        this.dataKeyAad(data.encryptionSchemaVersion, context, data.keyVersion),
      );

      const plaintext = this.decryptWithKey(
        dataKey,
        data.ciphertext,
        data.valueIv,
        data.valueAuthTag,
        this.valueAad(data.encryptionSchemaVersion, context),
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
   *
   * Поведінка AAD зберігає схему рядка:
   *   - legacy (schema 1) розпаковується/запаковується БЕЗ AAD і лишається legacy;
   *   - schema 2 і 3 розпаковуються з AAD старого keyVersion і запаковуються з AAD
   *     активного keyVersion (data-key переприв'язується до нового master-ключа).
   *     AAD data-key спільний для v2/v3 і не містить org, тож контексту тут
   *     достатньо secretId/versionId — тенант-привʼязка лишається на valueAad.
   */
  rewrapDataKey(
    data: {
      encryptedDataKey: Uint8Array;
      dataKeyIv: Uint8Array;
      dataKeyAuthTag: Uint8Array;
      keyVersion: string;
      encryptionSchemaVersion: number;
    },
    context: { secretId: string; secretVersionId: string },
  ): RewrappedDataKey | null {
    const activeVersion = this.keyProvider.getActiveVersion();
    if (data.keyVersion === activeVersion) {
      return null; // вже на активній версії
    }

    // 1. Розшифровуємо data-key старим master-ключем (AAD старого keyVersion)
    const oldMasterKey = this.keyProvider.getKey(data.keyVersion);
    const dataKey = this.decryptWithKey(
      oldMasterKey,
      data.encryptedDataKey,
      data.dataKeyIv,
      data.dataKeyAuthTag,
      this.dataKeyAad(data.encryptionSchemaVersion, context, data.keyVersion),
    );

    // 2. Перешифровуємо data-key активним master-ключем (AAD активного keyVersion)
    const newMasterKey = this.keyProvider.getKey(activeVersion);
    const reEnc = this.encryptWithKey(
      newMasterKey,
      dataKey,
      this.dataKeyAad(data.encryptionSchemaVersion, context, activeVersion),
    );

    return {
      encryptedDataKey: toBytes(reEnc.ciphertext),
      dataKeyIv: toBytes(reEnc.iv),
      dataKeyAuthTag: toBytes(reEnc.authTag),
      keyVersion: activeVersion,
    };
  }
}
