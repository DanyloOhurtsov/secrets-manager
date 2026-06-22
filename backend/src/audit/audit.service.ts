import { Injectable, Logger } from '@nestjs/common';
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

  async log(entry: AuditEntry): Promise<void> {
    try {
      // Дістаємо ім'я актора. Запис в журналі має бути самодостатнім,
      // тож зберігаємо ім'я в момент події — навіть якщо identity потім видалять.
      const actor = await this.prisma.identity.findUnique({
        where: { id: entry.actorId },
        select: { name: true },
      });

      const organization = entry.organizationId
        ? await this.prisma.organization.findUnique({
            where: { id: entry.organizationId },
            select: { name: true },
          })
        : null;

      await this.prisma.auditLog.create({
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
    } catch (err) {
      this.logger.error(`Failed to write audit log: ${entry.action}`, err);
    }
  }
}
