import { Controller, Get, Post, Delete, Body, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SecretsService } from './secrets.service';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { CreateSecretDto } from './dto';
import type { AuthPrincipal } from '../auth/auth.types';

@Controller('environments/:environmentId/secrets')
export class SecretsController {
  constructor(private readonly secretsService: SecretsService) {}

  @Post()
  create(
    @CurrentIdentity() identity: AuthPrincipal,
    @Param('environmentId') environmentId: string,
    @Body() body: CreateSecretDto,
  ) {
    return this.secretsService.create(
      identity,
      environmentId,
      body.key,
      body.value,
    );
  }

  @Get()
  @Throttle({ strict: { limit: 10, ttl: 60000 } })
  findByEnvironment(
    @CurrentIdentity() identity: AuthPrincipal,
    @Param('environmentId') environmentId: string,
  ) {
    return this.secretsService.findByEnvironment(identity, environmentId);
  }

  @Delete(':id')
  remove(@CurrentIdentity() identity: AuthPrincipal, @Param('id') id: string) {
    return this.secretsService.remove(identity, id);
  }
}
