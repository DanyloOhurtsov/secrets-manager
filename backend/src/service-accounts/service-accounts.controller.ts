import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ServiceAccountsService } from './service-accounts.service';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import { CreateServiceAccountDto, CreateServiceAccountTokenDto } from './dto';

@Controller('organizations/:organizationId/service-accounts')
export class ServiceAccountsController {
  constructor(private readonly serviceAccounts: ServiceAccountsService) {}

  @Post()
  create(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('organizationId') organizationId: string,
    @Body() body: CreateServiceAccountDto,
  ) {
    return this.serviceAccounts.create(actor, organizationId, body.name);
  }

  @Get()
  list(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('organizationId') organizationId: string,
  ) {
    return this.serviceAccounts.list(actor, organizationId);
  }

  @Delete(':identityId')
  remove(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('organizationId') organizationId: string,
    @Param('identityId') identityId: string,
  ) {
    return this.serviceAccounts.remove(actor, organizationId, identityId);
  }

  @Post(':identityId/tokens')
  issueToken(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('organizationId') organizationId: string,
    @Param('identityId') identityId: string,
    @Body() body: CreateServiceAccountTokenDto,
  ) {
    return this.serviceAccounts.issueToken(
      actor,
      organizationId,
      identityId,
      body.label,
      body.expiresInDays,
    );
  }

  @Get(':identityId/tokens')
  listTokens(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('organizationId') organizationId: string,
    @Param('identityId') identityId: string,
  ) {
    return this.serviceAccounts.listTokens(actor, organizationId, identityId);
  }

  @Delete(':identityId/tokens/:tokenId')
  revokeToken(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('organizationId') organizationId: string,
    @Param('identityId') identityId: string,
    @Param('tokenId') tokenId: string,
  ) {
    return this.serviceAccounts.revokeToken(
      actor,
      organizationId,
      identityId,
      tokenId,
    );
  }
}
