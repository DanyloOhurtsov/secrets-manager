import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
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

describe('AuthService (M2 logout + fail-closed auth audit)', () => {
  let service: AuthService;
  let prisma: { identity: { findUnique: jest.Mock } };
  let passwords: { verify: jest.Mock };
  let sessions: { issue: jest.Mock; verify: jest.Mock; revoke: jest.Mock };
  let audit: { logRequired: jest.Mock; logBestEffort: jest.Mock };

  beforeEach(async () => {
    prisma = { identity: { findUnique: jest.fn() } };
    passwords = { verify: jest.fn().mockResolvedValue(true) };
    sessions = {
      issue: jest.fn().mockResolvedValue('sess_token'),
      verify: jest.fn(),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    audit = {
      logRequired: jest.fn().mockResolvedValue(undefined),
      logBestEffort: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordService, useValue: passwords },
        { provide: SessionService, useValue: sessions },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // Test #5: login/logout must fail if the required audit write fails.
  it('login fails with a safe 503 when the required audit write fails', async () => {
    prisma.identity.findUnique.mockResolvedValue({
      id: 'id-1',
      name: 'Human',
      email: 'human@example.com',
      type: 'human',
      isSuperadmin: false,
      passwordHash: 'scrypt$salt$hash',
    });
    audit.logRequired.mockRejectedValueOnce(
      new ServiceUnavailableException('Audit log unavailable'),
    );

    await expect(
      service.login('human@example.com', 'pw'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('logout fails with a safe 503 when the required audit write fails', async () => {
    audit.logRequired.mockRejectedValueOnce(
      new ServiceUnavailableException('Audit log unavailable'),
    );

    await expect(service.logout(principal())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  // Test #2: DELETE /auth/session with a session token revokes that session.
  it('revokes the current session and audits the logout', async () => {
    await expect(service.logout(principal())).resolves.toEqual({
      revoked: true,
    });
    expect(sessions.revoke).toHaveBeenCalledWith('sess-row-1');
    expect(audit.logRequired).toHaveBeenCalledWith(
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
    expect(audit.logRequired).not.toHaveBeenCalled();
  });

  it('rejects a session principal with no sessionId (defensive) without revoking', async () => {
    await expect(
      service.logout(principal({ sessionId: undefined })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sessions.revoke).not.toHaveBeenCalled();
  });
});
