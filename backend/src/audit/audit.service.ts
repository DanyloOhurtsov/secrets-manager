import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

interface AuditEntry {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  organizationId?: string | null;
  projectId?: string | null;
  environmentId?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  // Власне запис у журнал. Кидає при будь-якій помилці БД — обгортки нижче
  // вирішують, чи валити запит (logRequired), чи проковтнути (logBestEffort).
  //
  // client: за замовчуванням — звичайний Prisma; якщо передати транзакційний
  // клієнт (tx), запис журналу йде В ТІЙ САМІЙ транзакції, що й мутація — і якщо
  // вставка журналу падає, мутація відкочується разом із ним (transaction-level
  // fail-closed). PrismaClient структурно сумісний із Prisma.TransactionClient.
  private async write(
    entry: AuditEntry,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    // Дістаємо ім'я актора/організації в момент події — запис у журналі має бути
    // самодостатнім, навіть якщо їх згодом видалять.
    const actor = await client.identity.findUnique({
      where: { id: entry.actorId },
      select: { name: true },
    });

    const organization = entry.organizationId
      ? await client.organization.findUnique({
          where: { id: entry.organizationId },
          select: { name: true },
        })
      : null;

    await client.auditLog.create({
      data: {
        actorId: entry.actorId,
        actorName: actor?.name ?? 'unknown',
        organizationId: entry.organizationId ?? null,
        organizationName: organization?.name ?? null,
        projectId: entry.projectId ?? null,
        environmentId: entry.environmentId ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Best-effort: для read-only / low-risk подій (напр. secret.list, перегляди
   * метаданих). Помилку запису ковтаємо й лише логуємо — доступність читань
   * важливіша за повноту журналу. Запит НЕ валимо.
   */
  async logBestEffort(entry: AuditEntry): Promise<void> {
    try {
      await this.write(entry);
    } catch (err) {
      this.logger.error(
        `Failed to write best-effort audit log: ${entry.action}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Fail-closed: для критичних дій (secret.reveal, мутації секретів/грантів/
   * членства/проєктів, auth login/logout, токени, platform-admin мутації). Якщо
   * аудит не записався — дія вважається НЕВДАЛОЮ: кидаємо 503 із безпечним
   * повідомленням, без деталей БД.
   *
   * ВАЖЛИВО (ordering): для secret.reveal викликати ПЕРЕД розшифруванням і
   * поверненням плейнтексту — якщо аудит впав, значення не має покинути сервер.
   *
   * tx: для МУТАЦІЙ передавати транзакційний клієнт тієї самої $transaction, що
   * й сама мутація — тоді збій журналу відкочує мутацію (transaction-level
   * fail-closed). Без tx — лишається response-level (мутація вже закомічена).
   */
  async logRequired(
    entry: AuditEntry,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    try {
      await this.write(entry, tx);
    } catch (err) {
      this.logger.error(
        `Failed to write REQUIRED audit log: ${entry.action}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new ServiceUnavailableException('Audit log unavailable');
    }
  }
}
