import { Module } from '@nestjs/common';
import { GrantsController } from './grants.controller';
import { GrantsService } from './grants.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [GrantsController],
  providers: [GrantsService, PrismaService],
})
export class GrantsModule {}
