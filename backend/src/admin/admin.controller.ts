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

@Controller('admin')
@UseGuards(SuperadminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // --- Identity ---
  @Post('identities')
  createIdentity(@Body() body: { name: string; type: string }) {
    return this.admin.createIdentity(body.name, body.type);
  }

  @Get('identities')
  listIdentities() {
    return this.admin.listIdentities();
  }

  // --- Tokens ---
  @Post('identities/:identityId/tokens')
  issueToken(
    @Param('identityId') identityId: string,
    @Body() body: { label?: string },
  ) {
    return this.admin.issueToken(identityId, body.label);
  }

  @Get('identities/:identityId/tokens')
  listTokens(@Param('identityId') identityId: string) {
    return this.admin.listTokens(identityId);
  }

  @Delete('tokens/:tokenId')
  revokeToken(@Param('tokenId') tokenId: string) {
    return this.admin.revokeToken(tokenId);
  }

  // --- Grants ---
  @Post('identities/:identityId/grants')
  createGrant(
    @Param('identityId') identityId: string,
    @Body() body: { projectId: string; role: string; environment?: string },
  ) {
    return this.admin.createGrant(
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
  revokeGrant(@Param('grantId') grantId: string) {
    return this.admin.revokeGrant(grantId);
  }
}
