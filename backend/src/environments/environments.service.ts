import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthPrincipal } from '../auth/auth.types';
import { AuthorizationService } from '../auth/authorization.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class EnvironmentsService {
  constructor(
    private prisma: PrismaService,
    private authz: AuthorizationService,
    private audit: AuditService,
  ) {}

  async create(actor: AuthPrincipal, projectId: string, name: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    await this.authz.checkProjectAccess(actor, projectId, 'manageProject');

    const environment = await this.prisma.environment.create({
      data: { name, projectId },
    });

    await this.audit.log({
      actorId: actor.id,
      organizationId: project.organizationId,
      projectId,
      environmentId: environment.id,
      action: 'environment.create',
      targetType: 'environment',
      targetId: environment.id,
      metadata: { name },
    });

    return environment;
  }

  async findByProject(actor: AuthPrincipal, projectId: string) {
    await this.authz.getProjectForActor(actor, projectId);
    return this.prisma.environment.findMany({
      where: { projectId },
    });
  }

  async remove(actor: AuthPrincipal, id: string) {
    const env = await this.prisma.environment.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!env) throw new NotFoundException('Environment not found');
    await this.authz.checkProjectAccess(actor, env.projectId, 'manageProject');

    await this.audit.log({
      actorId: actor.id,
      organizationId: env.project.organizationId,
      projectId: env.projectId,
      environmentId: id,
      action: 'environment.delete',
      targetType: 'environment',
      targetId: id,
      metadata: { name: env.name },
    });

    return this.prisma.environment.delete({ where: { id } });
  }
}
