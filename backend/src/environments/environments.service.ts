import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    const project = await this.authz.getProjectForActor(actor, projectId);
    const environments = await this.prisma.environment.findMany({
      where: { projectId },
    });
    // Актор із грантами лише на окремі оточення бачить тільки їх (org-admin та
    // грант на весь проєкт → усі). Решту просто не повертаємо.
    const scope = await this.authz.environmentScopeForActor(
      actor,
      projectId,
      project.organizationId,
    );
    if (scope === 'all') return environments;
    return environments.filter((e) => scope.has(e.id));
  }

  async rename(actor: AuthPrincipal, id: string, name: string) {
    const env = await this.prisma.environment.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!env) throw new NotFoundException('Environment not found');
    await this.authz.checkProjectAccess(actor, env.projectId, 'manageProject');

    const updated = await this.prisma.environment
      .update({ where: { id }, data: { name } })
      .catch((err) => {
        // Унікальність [projectId, name] — інше оточення вже має цю назву.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new ConflictException(
            'An environment with this name already exists in the project',
          );
        }
        throw err;
      });

    await this.audit.log({
      actorId: actor.id,
      organizationId: env.project.organizationId,
      projectId: env.projectId,
      environmentId: id,
      action: 'environment.update',
      targetType: 'environment',
      targetId: id,
      metadata: { from: env.name, to: name },
    });

    return updated;
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
