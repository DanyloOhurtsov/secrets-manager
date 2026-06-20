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
import { CreateIdentityDto, IssueTokenDto, CreateGrantDto } from './dto';

@Controller('admin')
@UseGuards(SuperadminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post('identities')
  createIdentity(@Body() body: CreateIdentityDto) {
    return this.admin.createIdentity(body.name, body.type);
  }

  @Get('identities')
  listIdentities() {
    return this.admin.listIdentities();
  }

  @Post('identities/:identityId/tokens')
  issueToken(
    @Param('identityId') identityId: string,
    @Body() body: IssueTokenDto,
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

  @Post('identities/:identityId/grants')
  createGrant(
    @Param('identityId') identityId: string,
    @Body() body: CreateGrantDto,
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
