import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { KeyProvider } from '../crypto/key-provider.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class RotationService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private keyProvider: KeyProvider,
    private audit: AuditService,
  ) {}

  /**
   * Перешифровує data-keys усіх версій секретів, що не на активній версії master-ключа.
   * Ідемпотентна: версії, вже на активній версії, пропускаються.
   * Значення секретів не зачіпаються — лише "конверт" навколо data-key.
   */
  async rotate(actorId: string) {
    const activeVersion = this.keyProvider.getActiveVersion();

    await this.audit.logRequired({
      actorId,
      action: 'key_rotation.start',
      targetType: 'system',
      targetId: activeVersion,
      metadata: { toVersion: activeVersion },
    });

    // беремо лише ті, що не на активній версії
    const versions = await this.prisma.secretVersion.findMany({
      where: { keyVersion: { not: activeVersion } },
    });

    let rotated = 0;
    const failed: string[] = [];

    for (const version of versions) {
      try {
        const rewrapped = this.crypto.rewrapDataKey(
          {
            encryptedDataKey: version.encryptedDataKey,
            dataKeyIv: version.dataKeyIv,
            dataKeyAuthTag: version.dataKeyAuthTag,
            keyVersion: version.keyVersion,
            encryptionSchemaVersion: version.encryptionSchemaVersion,
          },
          { secretId: version.secretId, secretVersionId: version.id },
        );

        if (!rewrapped) continue; // вже на активній (на випадок гонки)

        await this.prisma.secretVersion.update({
          where: { id: version.id },
          data: {
            encryptedDataKey: rewrapped.encryptedDataKey,
            dataKeyIv: rewrapped.dataKeyIv,
            dataKeyAuthTag: rewrapped.dataKeyAuthTag,
            keyVersion: rewrapped.keyVersion,
          },
        });
        rotated++;
      } catch {
        // не валимо весь процес через один секрет — фіксуємо й продовжуємо
        failed.push(version.id);
      }
    }

    await this.audit.logRequired({
      actorId,
      action: 'key_rotation.complete',
      targetType: 'system',
      targetId: activeVersion,
      metadata: { rotated, failed: failed.length, toVersion: activeVersion },
    });

    return {
      activeVersion,
      total: versions.length,
      rotated,
      failed,
    };
  }
}
