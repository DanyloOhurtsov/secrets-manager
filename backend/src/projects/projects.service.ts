import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async create(actorId: string, name: string) {
    // Проєкт + admin-grant творцю — атомарно в одній транзакції.
    // Якщо щось упаде, не лишиться "осиротілого" проєкту без доступу.
    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({ data: { name } });
      await tx.grant.create({
        data: {
          identityId: actorId,
          projectId: created.id,
          environment: null,
          role: 'admin',
        },
      });
      return created;
    });

    await this.audit.log({
      actorId,
      action: 'project.create',
      targetType: 'project',
      targetId: project.id,
      metadata: { name },
    });

    return project;
  }

  findAll() {
    return this.prisma.project.findMany({
      include: { environments: true },
    });
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { environments: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async remove(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    return this.prisma.project.delete({ where: { id } });
  }
}
