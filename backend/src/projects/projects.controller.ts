import { Controller, Get, Post, Delete, Body, Param } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, TransferProjectDto } from './dto';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import type { AuthPrincipal } from '../auth/auth.types';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  create(
    @CurrentIdentity() actor: AuthPrincipal,
    @Body() body: CreateProjectDto,
  ) {
    return this.projectsService.create(actor, body.name, body.organizationId);
  }

  @Get()
  findAll(@CurrentIdentity() actor: AuthPrincipal) {
    return this.projectsService.findAll(actor);
  }

  @Get(':id')
  findOne(@CurrentIdentity() actor: AuthPrincipal, @Param('id') id: string) {
    return this.projectsService.findOne(actor, id);
  }

  @Get(':id/capabilities')
  capabilities(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('id') id: string,
  ) {
    return this.projectsService.capabilities(actor, id);
  }

  @Post(':id/transfer')
  transfer(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: TransferProjectDto,
  ) {
    return this.projectsService.transfer(actor, id, body.targetOrganizationId);
  }

  @Delete(':id')
  remove(@CurrentIdentity() actor: AuthPrincipal, @Param('id') id: string) {
    return this.projectsService.remove(actor, id);
  }
}
