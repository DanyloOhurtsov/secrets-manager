import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  create(name: string) {
    return this.prisma.project.create({ data: { name } });
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
