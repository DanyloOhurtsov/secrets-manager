import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { EnvironmentsService } from './environments.service';
import { CreateEnvironmentDto } from './dto';

@Controller('projects/:projectId/environments')
export class EnvironmentsController {
  constructor(private readonly environmentsService: EnvironmentsService) {}

  @Post()
  create(
    @Param('projectId') projectId: string,
    @Body() body: CreateEnvironmentDto,
  ) {
    return this.environmentsService.create(projectId, body.name);
  }

  @Get()
  findByProject(@Param('projectId') projectId: string) {
    return this.environmentsService.findByProject(projectId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.environmentsService.remove(id);
  }
}
