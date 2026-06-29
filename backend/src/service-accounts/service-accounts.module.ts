import { Module } from '@nestjs/common';
import { ServiceAccountsController } from './service-accounts.controller';
import { ServiceAccountsService } from './service-accounts.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [ServiceAccountsController],
  providers: [ServiceAccountsService, PrismaService],
})
export class ServiceAccountsModule {}
