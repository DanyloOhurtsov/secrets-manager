import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService, PrismaService],
})
export class OrganizationsModule {}
