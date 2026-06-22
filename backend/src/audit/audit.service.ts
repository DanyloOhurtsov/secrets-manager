import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

interface AuditEntry {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      // Дістаємо ім'я актора. Запис в журналі має бути самодостатнім,
      // тож зберігаємо ім'я в момент події — навіть якщо identity потім видалять.
      const actor = await this.prisma.identity.findUnique({
        where: { id: entry.actorId },
        select: { name: true },
      });

      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId,
          actorName: actor?.name ?? 'unknown',
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log: ${entry.action}`, err);
    }
  }
}
