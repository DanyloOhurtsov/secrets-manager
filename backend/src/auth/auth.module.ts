import { Module, Global } from '@nestjs/common';
import { TokenService } from './token.service';
import { AuthGuard } from './auth.guard';
import { AuthorizationService } from './authorization.service';
import { PrismaService } from '../prisma.service';

@Global()
@Module({
  providers: [TokenService, AuthGuard, AuthorizationService, PrismaService],
  exports: [TokenService, AuthGuard, AuthorizationService],
})
export class AuthModule {}
