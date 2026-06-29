import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { GrantsService } from './grants.service';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import { CreateGrantDto, UpdateGrantDto } from './dto';

// Гранти — площина даних, але керуються з рівня організації: роздавати доступ
// до проєктів/оточень своєї org може ЛИШЕ org owner/admin (enforced у
// GrantsService через assertOrganizationAdmin). Делеговані грантхолдери —
// навіть із legacy-прапорцем canManageGrants — керувати грантами не можуть.
// Жодних /admin/* — це суто tenant-маршрути.
@Controller('organizations/:organizationId/grants')
export class GrantsController {
  constructor(private readonly grants: GrantsService) {}

  @Post()
  create(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('organizationId') organizationId: string,
    @Body() body: CreateGrantDto,
  ) {
    return this.grants.create(actor, organizationId, body);
  }

  @Get()
  list(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('organizationId') organizationId: string,
  ) {
    return this.grants.list(actor, organizationId);
  }

  @Patch(':grantId')
  update(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('organizationId') organizationId: string,
    @Param('grantId') grantId: string,
    @Body() body: UpdateGrantDto,
  ) {
    return this.grants.update(actor, organizationId, grantId, body);
  }

  @Delete(':grantId')
  revoke(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('organizationId') organizationId: string,
    @Param('grantId') grantId: string,
  ) {
    return this.grants.revoke(actor, organizationId, grantId);
  }
}
