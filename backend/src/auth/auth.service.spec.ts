import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from './auth.types';

function principal(overrides: Partial<AuthPrincipal> = {}): AuthPrincipal {
  return {
    id: 'id-1',
    name: 'Human',
    email: 'human@example.com',
    type: 'human',
    isSuperadmin: false,
    serviceOrganizationId: null,
    authMethod: 'session',
    sessionId: 'sess-row-1',
    ...overrides,
  };
}

describe('AuthService logout (M2 — session revocation)', () => {
  let service: AuthService;
  let sessions: { issue: jest.Mock; verify: jest.Mock; revoke: jest.Mock };
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    sessions = {
      issue: jest.fn(),
      verify: jest.fn(),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: {} },
        { provide: PasswordService, useValue: {} },
        { provide: SessionService, useValue: sessions },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // Test #2: DELETE /auth/session with a session token revokes that session.
  it('revokes the current session and audits the logout', async () => {
    await expect(service.logout(principal())).resolves.toEqual({
      revoked: true,
    });
    expect(sessions.revoke).toHaveBeenCalledWith('sess-row-1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.logout', actorId: 'id-1' }),
    );
  });

  // Test #4: an API token (sm_...) caller must be rejected and the token must
  // NOT be revoked through this endpoint.
  it('rejects an API-token caller and revokes nothing', async () => {
    const apiToken = principal({ authMethod: 'token', sessionId: undefined });

    await expect(service.logout(apiToken)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(sessions.revoke).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects a session principal with no sessionId (defensive) without revoking', async () => {
    await expect(
      service.logout(principal({ sessionId: undefined })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sessions.revoke).not.toHaveBeenCalled();
  });
});
