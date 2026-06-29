import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { AccountService } from './account.service';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import { CreateTokenDto, SetActiveOrgDto } from './dto';

@Controller('me')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get('active-org')
  getActiveOrg(@CurrentIdentity() actor: AuthPrincipal) {
    return this.account.getActiveOrg(actor);
  }

  @Put('active-org')
  setActiveOrg(
    @CurrentIdentity() actor: AuthPrincipal,
    @Body() body: SetActiveOrgDto,
  ) {
    return this.account.setActiveOrg(actor, body.organizationId);
  }

  @Get('tokens')
  listTokens(@CurrentIdentity() actor: AuthPrincipal) {
    return this.account.listTokens(actor);
  }

  @Post('tokens')
  createToken(
    @CurrentIdentity() actor: AuthPrincipal,
    @Body() body: CreateTokenDto,
  ) {
    return this.account.createToken(actor, body.label, body.expiresInDays);
  }

  @Delete('tokens/:tokenId')
  revokeToken(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('tokenId') tokenId: string,
  ) {
    return this.account.revokeToken(actor, tokenId);
  }
}
