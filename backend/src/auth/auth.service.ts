import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { AuthPrincipal } from './auth.types';

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

  // Logout — відкликає ЛИШЕ поточну browser-сесію. API-токени (sm_...) через цей
  // шлях не чіпаємо: для них немає sessionId, тож повертаємо 400 (їх відкликають
  // окремо через /me/tokens). Frontend викликає це лише для authMethod==='session'.
  async logout(actor: AuthPrincipal): Promise<{ revoked: boolean }> {
    if (actor.authMethod !== 'session' || !actor.sessionId) {
      throw new BadRequestException(
        'Logout applies to browser sessions only; revoke API tokens via token management',
      );
    }

    await this.sessions.revoke(actor.sessionId);

    await this.audit.log({
      actorId: actor.id,
      action: 'auth.logout',
      targetType: 'identity',
      targetId: actor.id,
      metadata: { self: true },
    });

    return { revoked: true };
  }
}
