import { Controller, Get, Post, Param, UseGuards, Query } from '@nestjs/common';
import { AdminService } from './admin.service';
import { RotationService } from './rotation.service';
import { SuperadminGuard } from '../auth/superadmin.guard';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { parseQueryDate, parseQueryList } from './audit-query';

@Controller('admin')
@UseGuards(SuperadminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly rotation: RotationService,
  ) {}

  // --- Organizations (platform view: metadata + suspension, never secrets) ---
  @Get('organizations')
  listOrganizations() {
    return this.admin.listOrganizations();
  }

  @Post('organizations/:id/suspend')
  suspendOrganization(
    @CurrentIdentity() actor: { id: string },
    @Param('id') id: string,
  ) {
    return this.admin.setOrganizationStatus(actor.id, id, 'suspended');
  }

  @Post('organizations/:id/unsuspend')
  unsuspendOrganization(
    @CurrentIdentity() actor: { id: string },
    @Param('id') id: string,
  ) {
    return this.admin.setOrganizationStatus(actor.id, id, 'active');
  }

  // --- Global audit ---
  @Get('audit')
  listAuditLog(
    @Query('action') action?: string | string[],
    @Query('organizationId') organizationId?: string,
    @Query('projectId') projectId?: string,
    @Query('environmentId') environmentId?: string,
    @Query('actorId') actorId?: string,
    @Query('targetType') targetType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.admin.listAuditLog(100, {
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

  @Get('audit/actions')
  listAuditActions(
    @Query('organizationId') organizationId?: string,
    @Query('projectId') projectId?: string,
    @Query('environmentId') environmentId?: string,
  ) {
    return this.admin.listAuditActions({
      organizationId,
      projectId,
      environmentId,
    });
  }

  // --- System ---
  @Get('health')
  health() {
    return this.admin.health();
  }

  @Post('rotate-keys')
  rotateKeys(@CurrentIdentity() actor: { id: string }) {
    return this.rotation.rotate(actor.id);
  }
}
