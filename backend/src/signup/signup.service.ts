import { ConflictException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';

@Injectable()
export class SignupService {
  constructor(
    private prisma: PrismaService,
    private passwords: PasswordService,
    private sessions: SessionService,
    private audit: AuditService,
  ) {}

  private personalSlug(email: string): string {
    const localPart = email.split('@')[0] ?? 'user';
    const base = localPart
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32);
    return `${base || 'user'}-${randomBytes(3).toString('hex')}`;
  }

  async signup(name: string, email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.prisma.identity.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Email is already registered');

    const passwordHash = await this.passwords.hash(password);

    const { identity, organization } = await this.prisma.$transaction(
      async (tx) => {
        const createdIdentity = await tx.identity.create({
          data: {
            name,
            email: normalizedEmail,
            passwordHash,
            type: 'human',
          },
        });

        const createdOrganization = await tx.organization.create({
          data: {
            name: `${name}'s workspace`,
            slug: this.personalSlug(normalizedEmail),
            type: 'personal',
          },
        });

        await tx.organizationMembership.create({
          data: {
            organizationId: createdOrganization.id,
            identityId: createdIdentity.id,
            role: 'owner',
          },
        });

        return {
          identity: createdIdentity,
          organization: createdOrganization,
        };
      },
    );

    const sessionToken = await this.sessions.issue(identity.id);

    await this.audit.logRequired({
      actorId: identity.id,
      organizationId: organization.id,
      action: 'auth.signup',
      targetType: 'identity',
      targetId: identity.id,
      metadata: { email: normalizedEmail },
    });

    // Кожне створення організації має слід в audit — включно з personal workspace.
    await this.audit.logRequired({
      actorId: identity.id,
      organizationId: organization.id,
      action: 'organization.create',
      targetType: 'organization',
      targetId: organization.id,
      metadata: { name: organization.name, type: organization.type },
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
      personalWorkspace: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        type: organization.type,
      },
    };
  }
}
