import { Controller, Get, Query } from '@nestjs/common';
import { AdminService } from './admin.service';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import { parseQueryDate, parseQueryList } from './audit-query';

@Controller('audit')
export class AuditController {
  constructor(private admin: AdminService) {}

  @Get()
  listAudit(
    @CurrentIdentity() actor: AuthPrincipal,
    @Query('action') action?: string | string[],
    @Query('organizationId') organizationId?: string,
    @Query('projectId') projectId?: string,
    @Query('environmentId') environmentId?: string,
    @Query('actorId') actorId?: string,
    @Query('targetType') targetType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.admin.listAuditForActor(actor, {
      actions: parseQueryList(action),
      organizationId,
      projectId,
      environmentId,
      actorId,
      targetType,
      from: parseQueryDate(from),
      to: parseQueryDate(to),
    });
  }

  @Get('actions')
  listActions(
    @CurrentIdentity() actor: AuthPrincipal,
    @Query('organizationId') organizationId?: string,
    @Query('projectId') projectId?: string,
    @Query('environmentId') environmentId?: string,
  ) {
    return this.admin.listAuditActionsForActor(actor, {
      organizationId,
      projectId,
      environmentId,
    });
  }
}
