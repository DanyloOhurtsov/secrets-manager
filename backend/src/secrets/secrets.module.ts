import { Module } from '@nestjs/common';
import { SecretsService } from './secrets.service';
import { SecretsController } from './secrets.controller';
import { PrismaService } from '../prisma.service';
import { CryptoModule } from '../crypto/crypto.module';

@Module({
  imports: [CryptoModule],
  controllers: [SecretsController],
  providers: [SecretsService, PrismaService],
})
export class SecretsModule {}
