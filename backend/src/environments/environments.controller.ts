import { Controller, Get, Post, Delete, Body, Param } from '@nestjs/common';
import { EnvironmentsService } from './environments.service';
import { CreateEnvironmentDto } from './dto';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import type { AuthPrincipal } from '../auth/auth.types';

@Controller('projects/:projectId/environments')
export class EnvironmentsController {
  constructor(private readonly environmentsService: EnvironmentsService) {}

  @Post()
  create(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('projectId') projectId: string,
    @Body() body: CreateEnvironmentDto,
  ) {
    return this.environmentsService.create(actor, projectId, body.name);
  }

  @Get()
  findByProject(
    @CurrentIdentity() actor: AuthPrincipal,
    @Param('projectId') projectId: string,
  ) {
    return this.environmentsService.findByProject(actor, projectId);
  }

  @Delete(':id')
  remove(@CurrentIdentity() actor: AuthPrincipal, @Param('id') id: string) {
    return this.environmentsService.remove(actor, id);
  }
}
