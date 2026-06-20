import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { SecretsService } from './secrets.service';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { CreateSecretDto } from './dto';

@Controller('environments/:environmentId/secrets')
export class SecretsController {
  constructor(private readonly secretsService: SecretsService) {}

  @Post()
  create(
    @CurrentIdentity() identity: { id: string },
    @Param('environmentId') environmentId: string,
    @Body() body: CreateSecretDto,
  ) {
    return this.secretsService.create(
      identity.id,
      environmentId,
      body.key,
      body.value,
    );
  }

  @Get()
  findByEnvironment(
    @CurrentIdentity() identity: { id: string },
    @Param('environmentId') environmentId: string,
  ) {
    return this.secretsService.findByEnvironment(identity.id, environmentId);
  }

  @Delete(':id')
  remove(
    @CurrentIdentity() identity: { id: string },
    @Param('id') id: string,
  ) {
    return this.secretsService.remove(identity.id, id);
  }
}
