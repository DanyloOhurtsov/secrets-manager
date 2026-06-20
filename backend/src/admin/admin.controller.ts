import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { SuperadminGuard } from '../auth/superadmin.guard';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { CreateIdentityDto, IssueTokenDto, CreateGrantDto } from './dto';

@Controller('admin')
@UseGuards(SuperadminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post('identities')
  createIdentity(
    @CurrentIdentity() actor: { id: string },
    @Body() body: CreateIdentityDto,
  ) {
    return this.admin.createIdentity(actor.id, body.name, body.type);
  }

  @Get('identities')
  listIdentities() {
    return this.admin.listIdentities();
  }

  @Post('identities/:identityId/tokens')
  issueToken(
    @CurrentIdentity() actor: { id: string },
    @Param('identityId') identityId: string,
    @Body() body: IssueTokenDto,
  ) {
    return this.admin.issueToken(actor.id, identityId, body.label);
  }

  @Get('identities/:identityId/tokens')
  listTokens(@Param('identityId') identityId: string) {
    return this.admin.listTokens(identityId);
  }

  @Delete('tokens/:tokenId')
  revokeToken(
    @CurrentIdentity() actor: { id: string },
    @Param('tokenId') tokenId: string,
  ) {
    return this.admin.revokeToken(actor.id, tokenId);
  }

  @Post('identities/:identityId/grants')
  createGrant(
    @CurrentIdentity() actor: { id: string },
    @Param('identityId') identityId: string,
    @Body() body: CreateGrantDto,
  ) {
    return this.admin.createGrant(
      actor.id,
      identityId,
      body.projectId,
      body.role,
      body.environment,
    );
  }

  @Get('identities/:identityId/grants')
  listGrants(@Param('identityId') identityId: string) {
    return this.admin.listGrants(identityId);
  }

  @Delete('grants/:grantId')
  revokeGrant(
    @CurrentIdentity() actor: { id: string },
    @Param('grantId') grantId: string,
  ) {
    return this.admin.revokeGrant(actor.id, grantId);
  }

  // --- Audit ---
  @Get('audit')
  listAuditLog() {
    return this.admin.listAuditLog();
  }
}
