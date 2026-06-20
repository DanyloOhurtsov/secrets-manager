import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class EnvironmentsService {
  constructor(private prisma: PrismaService) {}

  async create(projectId: string, name: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');

    return this.prisma.environment.create({
      data: { name, projectId },
    });
  }

  findByProject(projectId: string) {
    return this.prisma.environment.findMany({
      where: { projectId },
    });
  }

  async remove(id: string) {
    const env = await this.prisma.environment.findUnique({ where: { id } });
    if (!env) throw new NotFoundException('Environment not found');
    return this.prisma.environment.delete({ where: { id } });
  }
}
