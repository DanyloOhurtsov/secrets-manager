import { Module, Global } from '@nestjs/common';
import { TokenService } from './token.service';
import { AuthGuard } from './auth.guard';
import { AuthorizationService } from './authorization.service';
import { SuperadminGuard } from './superadmin.guard';
import { AuthController } from './auth.controller';
import { PrismaService } from '../prisma.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    TokenService,
    AuthGuard,
    AuthorizationService,
    SuperadminGuard,
    PrismaService,
  ],
  exports: [TokenService, AuthGuard, AuthorizationService, SuperadminGuard],
})
export class AuthModule {}
