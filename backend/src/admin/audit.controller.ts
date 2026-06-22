import { Controller, Get, Query } from '@nestjs/common';
import { AdminService } from './admin.service';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import type { AuthPrincipal } from '../auth/auth.types';

@Controller('audit')
export class AuditController {
  constructor(private admin: AdminService) {}

  @Get()
  listAudit(
    @CurrentIdentity() actor: AuthPrincipal,
    @Query('action') action?: string,
    @Query('organizationId') organizationId?: string,
    @Query('projectId') projectId?: string,
    @Query('environmentId') environmentId?: string,
  ) {
    return this.admin.listAuditForActor(actor, {
      action,
      organizationId,
      projectId,
      environmentId,
    });
  }
}
