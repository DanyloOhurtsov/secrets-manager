import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccountService } from './account.service';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../auth/authorization.service';
import { TokenService } from '../auth/token.service';
import { AuthPrincipal } from '../auth/auth.types';

function principal(overrides: Partial<AuthPrincipal> = {}): AuthPrincipal {
  return {
    id: 'actor-1',
    name: 'Actor',
    email: 'actor@example.com',
    type: 'human',
    isSuperadmin: false,
    serviceOrganizationId: null,
    authMethod: 'session',
    ...overrides,
  };
}

describe('AccountService', () => {
  let service: AccountService;
  let prisma: { token: { findUnique: jest.Mock } };
  let tokens: { issue: jest.Mock; revoke: jest.Mock };
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = { token: { findUnique: jest.fn() } };
    tokens = {
      issue: jest.fn().mockResolvedValue('sm_test'),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: PrismaService, useValue: prisma },
        { provide: TokenService, useValue: tokens },
        { provide: AuditService, useValue: audit },
        { provide: AuthorizationService, useValue: {} },
      ],
    }).compile();

    service = module.get<AccountService>(AccountService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('refuses personal tokens for service identities', async () => {
    await expect(
      service.createToken(principal({ type: 'service' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('translates expiresInDays into an absolute expiry', async () => {
    await service.createToken(principal(), 'ci', 7);
    const [, , expiresAt] = tokens.issue.mock.calls[0] as [
      string,
      string,
      Date,
    ];
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not let a user revoke a token they do not own', async () => {
    prisma.token.findUnique.mockResolvedValue({
      id: 't1',
      identityId: 'someone-else',
    });
    await expect(service.revokeToken(principal(), 't1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tokens.revoke).not.toHaveBeenCalled();
  });
});
