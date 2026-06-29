import { Module } from '@nestjs/common';
import { SignupController } from './signup.controller';
import { SignupService } from './signup.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [SignupController],
  providers: [SignupService, PrismaService],
})
export class SignupModule {}
