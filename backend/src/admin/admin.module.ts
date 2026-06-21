import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { RotationService } from './rotation.service';
import { PrismaService } from '../prisma.service';
import { CryptoModule } from '../crypto/crypto.module';

@Module({
  imports: [CryptoModule],
  controllers: [AdminController],
  providers: [AdminService, RotationService, PrismaService],
})
export class AdminModule {}
