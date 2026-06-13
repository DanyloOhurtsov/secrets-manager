import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { SecretsService } from './secrets.service';

@Controller('environments/:environmentId/secrets')
export class SecretsController {
  constructor(private readonly secretsService: SecretsService) {}

  @Post()
  create(
    @Param('environmentId') environmentId: string,
    @Body() body: { key: string; value: string },
  ) {
    return this.secretsService.create(environmentId, body.key, body.value);
  }

  @Get()
  findByEnvironment(@Param('environmentId') environmentId: string) {
    return this.secretsService.findByEnvironment(environmentId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.secretsService.remove(id);
  }
}
