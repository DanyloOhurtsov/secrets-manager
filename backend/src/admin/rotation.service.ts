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
   * Перешифровує data-keys усіх секретів, що не на активній версії master-ключа.
   * Ідемпотентна: секрети, вже на активній версії, пропускаються.
   * Значення секретів не зачіпаються — лише "конверт" навколо data-key.
   */
  async rotate(actorId: string) {
    const activeVersion = this.keyProvider.getActiveVersion();

    // беремо лише ті, що не на активній версії
    const secrets = await this.prisma.secret.findMany({
      where: { keyVersion: { not: activeVersion } },
    });

    let rotated = 0;
    const failed: string[] = [];

    for (const s of secrets) {
      try {
        const rewrapped = this.crypto.rewrapDataKey({
          encryptedDataKey: s.encryptedDataKey,
          dataKeyIv: s.dataKeyIv,
          dataKeyAuthTag: s.dataKeyAuthTag,
          keyVersion: s.keyVersion,
        });

        if (!rewrapped) continue; // вже на активній (на випадок гонки)

        await this.prisma.secret.update({
          where: { id: s.id },
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
        failed.push(s.id);
      }
    }

    await this.audit.log({
      actorId,
      action: 'keys.rotate',
      targetType: 'system',
      targetId: activeVersion,
      metadata: { rotated, failed: failed.length, toVersion: activeVersion },
    });

    return {
      activeVersion,
      total: secrets.length,
      rotated,
      failed,
    };
  }
}
