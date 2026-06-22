import { Module, Global } from '@nestjs/common';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { PasswordService } from './password.service';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { AuthorizationService } from './authorization.service';
import { SuperadminGuard } from './superadmin.guard';
import { AuthController } from './auth.controller';
import { PrismaService } from '../prisma.service';
import { AuditModule } from '../audit/audit.module';

@Global()
@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    SessionService,
    PasswordService,
    AuthGuard,
    AuthorizationService,
    SuperadminGuard,
    PrismaService,
  ],
  exports: [
    AuthService,
    TokenService,
    SessionService,
    PasswordService,
    AuthGuard,
    AuthorizationService,
    SuperadminGuard,
  ],
})
export class AuthModule {}
