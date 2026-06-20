import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export type Role = 'readonly' | 'developer' | 'admin';

const ROLE_LEVEL: Record<Role, number> = {
  readonly: 1,
  developer: 2,
  admin: 3,
};

@Injectable()
export class AuthorizationService {
  constructor(private prisma: PrismaService) {}

  async checkAccess(
    identityId: string,
    projectId: string,
    environment: string,
    requiredRole: Role,
  ): Promise<void> {
    const grants = await this.prisma.grant.findMany({
      where: {
        identityId,
        projectId,
        OR: [{ environment }, { environment: null }],
      },
    });

    if (grants.length === 0) {
      throw new ForbiddenException('No access to this project/environment');
    }

    const required = ROLE_LEVEL[requiredRole];
    const hasEnough = grants.some(
      (g) => ROLE_LEVEL[g.role as Role] >= required,
    );

    if (!hasEnough) {
      throw new ForbiddenException(`Requires ${requiredRole} role`);
    }
  }
}
