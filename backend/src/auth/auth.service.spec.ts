import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
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
  let passwords: { verify: jest.Mock; verifyAgainstDummyHash: jest.Mock };
  let sessions: { issue: jest.Mock; verify: jest.Mock; revoke: jest.Mock };
  let audit: { logRequired: jest.Mock; logBestEffort: jest.Mock };

  beforeEach(async () => {
    prisma = { identity: { findUnique: jest.fn() } };
    passwords = {
      verify: jest.fn().mockResolvedValue(true),
      verifyAgainstDummyHash: jest.fn().mockResolvedValue(false),
    };
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

  // L2: reduce user enumeration via login timing. Unknown email and existing
  // email + wrong password must look identical (same error, same hashing work).
  describe('login (L2 user-enumeration hardening)', () => {
    const humanIdentity = {
      id: 'id-1',
      name: 'Human',
      email: 'human@example.com',
      type: 'human',
      isSuperadmin: false,
      passwordHash: 'scrypt$salt$hash',
    };

    // Test #1: unknown email and existing-email-wrong-password are indistinguishable.
    it('returns the same status and message for unknown email and wrong password', async () => {
      prisma.identity.findUnique.mockResolvedValueOnce(null);
      const unknownErr: unknown = await service
        .login('nobody@example.com', 'pw')
        .catch((e: unknown) => e);

      prisma.identity.findUnique.mockResolvedValueOnce(humanIdentity);
      passwords.verify.mockResolvedValueOnce(false);
      const wrongPwErr: unknown = await service
        .login('human@example.com', 'wrong')
        .catch((e: unknown) => e);

      expect(unknownErr).toBeInstanceOf(UnauthorizedException);
      expect(wrongPwErr).toBeInstanceOf(UnauthorizedException);
      const a = unknownErr as UnauthorizedException;
      const b = wrongPwErr as UnauthorizedException;
      expect(a.getStatus()).toBe(b.getStatus());
      expect(a.getResponse()).toEqual(b.getResponse());
    });

    // Test #2: unknown email still performs dummy password verification work and
    // does NOT touch the real verify().
    it('performs dummy password verification when the email is unknown', async () => {
      prisma.identity.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.login('nobody@example.com', 'pw'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(passwords.verifyAgainstDummyHash).toHaveBeenCalledWith('pw');
      expect(passwords.verify).not.toHaveBeenCalled();
      expect(sessions.issue).not.toHaveBeenCalled();
    });

    // Non-human / passwordless identities take the same dummy-work branch.
    it('performs dummy password verification for a non-human identity', async () => {
      prisma.identity.findUnique.mockResolvedValueOnce({
        ...humanIdentity,
        type: 'service',
        passwordHash: null,
      });

      await expect(
        service.login('human@example.com', 'pw'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(passwords.verifyAgainstDummyHash).toHaveBeenCalledWith('pw');
      expect(passwords.verify).not.toHaveBeenCalled();
    });

    // Test #3: existing email + wrong password runs the REAL verify, not the dummy.
    it('performs real password verification for an existing email', async () => {
      prisma.identity.findUnique.mockResolvedValueOnce(humanIdentity);
      passwords.verify.mockResolvedValueOnce(false);

      await expect(
        service.login('human@example.com', 'wrong'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(passwords.verify).toHaveBeenCalledWith('wrong', 'scrypt$salt$hash');
      expect(passwords.verifyAgainstDummyHash).not.toHaveBeenCalled();
    });

    // Test #4: a correct password still issues a session (success path unchanged).
    it('issues a session on a successful login', async () => {
      prisma.identity.findUnique.mockResolvedValueOnce(humanIdentity);
      passwords.verify.mockResolvedValueOnce(true);

      const result = await service.login('human@example.com', 'correct');

      expect(passwords.verify).toHaveBeenCalledWith(
        'correct',
        'scrypt$salt$hash',
      );
      expect(passwords.verifyAgainstDummyHash).not.toHaveBeenCalled();
      expect(sessions.issue).toHaveBeenCalledWith('id-1');
      expect(result.sessionToken).toBe('sess_token');
      expect(result.identity).toEqual(
        expect.objectContaining({ id: 'id-1', email: 'human@example.com' }),
      );
    });
  });
});
