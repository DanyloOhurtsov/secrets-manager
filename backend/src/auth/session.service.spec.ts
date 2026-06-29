import { Test, TestingModule } from '@nestjs/testing';
import { SessionService } from './session.service';
import { PrismaService } from '../prisma.service';

const identity = {
  id: 'id-1',
  name: 'Human',
  email: 'human@example.com',
  type: 'human',
  isSuperadmin: false,
  serviceOrganizationId: null,
};

describe('SessionService', () => {
  let service: SessionService;
  let prisma: {
    session: {
      create: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      session: {
        create: jest.fn().mockResolvedValue({ id: 'sess-row-1' }),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [SessionService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<SessionService>(SessionService);
  });

  // Test #1: login/session issue creates a valid session.
  it('issues a sess_-prefixed token and persists ONLY its hash with a future expiry', async () => {
    const token = await service.issue('id-1');
    expect(token.startsWith('sess_')).toBe(true);

    expect(prisma.session.create).toHaveBeenCalledTimes(1);
    const arg = prisma.session.create.mock.calls[0][0] as {
      data: { identityId: string; sessionHash: string; expiresAt: Date };
    };
    expect(arg.data.identityId).toBe('id-1');
    // У БД — лише хеш, ніколи сам токен.
    expect(typeof arg.data.sessionHash).toBe('string');
    expect(arg.data.sessionHash).not.toBe(token);
    expect(arg.data.sessionHash).not.toContain(token);
    expect(arg.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('verifies a live session and exposes its sessionId (for logout)', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'sess-row-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      identity,
    });

    await expect(service.verify('sess_live')).resolves.toMatchObject({
      id: 'id-1',
      authMethod: 'session',
      sessionId: 'sess-row-1',
    });
  });

  // Test #3: the same session token is rejected after revocation.
  it('rejects a revoked session (immediate 401 path after logout)', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'sess-row-1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      identity,
    });

    await expect(service.verify('sess_revoked')).resolves.toBeNull();
  });

  it('rejects an expired session', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'sess-row-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1_000),
      identity,
    });

    await expect(service.verify('sess_expired')).resolves.toBeNull();
  });

  it('rejects an unknown session token', async () => {
    prisma.session.findUnique.mockResolvedValue(null);
    await expect(service.verify('sess_unknown')).resolves.toBeNull();
  });

  // Test #2 (backend half): revoke sets revokedAt; idempotent via updateMany.
  it('revoke() sets revokedAt and only touches un-revoked rows (idempotent)', async () => {
    await service.revoke('sess-row-1');
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'sess-row-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
