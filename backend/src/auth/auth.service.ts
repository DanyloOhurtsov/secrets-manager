import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private passwords: PasswordService,
    private sessions: SessionService,
    private audit: AuditService,
  ) {}

  async login(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const identity = await this.prisma.identity.findUnique({
      where: { email: normalizedEmail },
    });

    if (!identity || identity.type !== 'human' || !identity.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const ok = await this.passwords.verify(password, identity.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid email or password');

    const sessionToken = await this.sessions.issue(identity.id);

    await this.audit.log({
      actorId: identity.id,
      action: 'auth.login',
      targetType: 'identity',
      targetId: identity.id,
      metadata: { email: normalizedEmail },
    });

    return {
      sessionToken,
      identity: {
        id: identity.id,
        name: identity.name,
        email: identity.email,
        type: identity.type,
        isSuperadmin: identity.isSuperadmin,
      },
    };
  }
}
