import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import {
  AddMemberDto,
  ChangeMemberRoleDto,
  CreateOrganizationDto,
  TransferOwnershipDto,
  UpdateOrganizationDto,
} from './dto';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post()
  create(
    @CurrentIdentity() actor: AuthPrincipal,
    @Body() body: CreateOrganizationDto,
  ) {
    return this.organizations.createTeam(actor, body.name);
  }

  @Get()
  findMine(@CurrentIdentity() actor: AuthPrincipal) {
    return this.organizations.findMine(actor);
  }

  @Get(':id')
  findOne(@CurrentIdentity() actor: AuthPrincipal, @Param('id') id: string) {
    return this.organizations.findOne(actor, id);
  }

  @Patch(':id')
  rename(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: UpdateOrganizationDto,
  ) {
    return this.organizations.rename(actor, id, body.name);
  }

  @Delete(':id')
  remove(@CurrentIdentity() actor: AuthPrincipal, @Param('id') id: string) {
    return this.organizations.remove(actor, id);
  }

  @Post(':id/members')
  addMember(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: AddMemberDto,
  ) {
    return this.organizations.addMember(
      actor,
      id,
      body.email,
      body.role ?? 'member',
    );
  }

  @Patch(':id/members/:identityId')
  changeRole(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('id') id: string,
    @Param('identityId') identityId: string,
    @Body() body: ChangeMemberRoleDto,
  ) {
    return this.organizations.changeRole(actor, id, identityId, body.role);
  }

  @Delete(':id/members/:identityId')
  removeMember(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('id') id: string,
    @Param('identityId') identityId: string,
  ) {
    return this.organizations.removeMember(actor, id, identityId);
  }

  @Post(':id/transfer-ownership')
  transferOwnership(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: TransferOwnershipDto,
  ) {
    return this.organizations.transferOwnership(actor, id, body.identityId);
  }
}
