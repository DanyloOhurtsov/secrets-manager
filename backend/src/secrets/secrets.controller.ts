import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SecretsService } from './secrets.service';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { CreateSecretDto, RollbackSecretDto, UpdateSecretDto } from './dto';
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

  // Статичний маршрут — оголошуємо перед параметричними (':id/...'), щоб
  // 'capabilities' не зловив динамічний сегмент.
  @Get('capabilities')
  capabilities(
    @CurrentIdentity() identity: AuthPrincipal,
    @Param('environmentId') environmentId: string,
  ) {
    return this.secretsService.capabilities(identity, environmentId);
  }

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  findByEnvironment(
    @CurrentIdentity() identity: AuthPrincipal,
    @Param('environmentId') environmentId: string,
    @Query('reveal') reveal?: string,
  ) {
    return this.secretsService.findByEnvironment(
      identity,
      environmentId,
      reveal === 'true' || reveal === '1',
    );
  }

  @Get(':id/reveal')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  reveal(@CurrentIdentity() identity: AuthPrincipal, @Param('id') id: string) {
    return this.secretsService.revealOne(identity, id);
  }

  @Patch(':id')
  update(
    @CurrentIdentity() identity: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: UpdateSecretDto,
  ) {
    return this.secretsService.update(identity, id, body.value);
  }

  @Get(':id/versions')
  listVersions(
    @CurrentIdentity() identity: AuthPrincipal,
    @Param('id') id: string,
  ) {
    return this.secretsService.listVersions(identity, id);
  }

  @Post(':id/rollback')
  rollback(
    @CurrentIdentity() identity: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: RollbackSecretDto,
  ) {
    return this.secretsService.rollback(identity, id, body.toVersion);
  }

  @Delete(':id')
  remove(@CurrentIdentity() identity: AuthPrincipal, @Param('id') id: string) {
    return this.secretsService.remove(identity, id);
  }
}
