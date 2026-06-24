import { Test, TestingModule } from '@nestjs/testing';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma.service';

const entry = {
  actorId: 'a1',
  action: 'secret.reveal',
  targetType: 'secret',
  targetId: 's1',
};

describe('AuditService (selective fail-closed)', () => {
  let service: AuditService;
  let prisma: {
    identity: { findUnique: jest.Mock };
    organization: { findUnique: jest.Mock };
    auditLog: { create: jest.Mock };
  };

  beforeEach(async () => {
    // Притлумлюємо очікувані logger.error під час тестів зі збоями БД.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    prisma = {
      identity: { findUnique: jest.fn().mockResolvedValue({ name: 'Actor' }) },
      organization: { findUnique: jest.fn().mockResolvedValue(null) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('logBestEffort writes the audit row on the happy path', async () => {
    await expect(service.logBestEffort(entry)).resolves.toBeUndefined();
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('logBestEffort swallows audit DB errors and does NOT throw', async () => {
    prisma.auditLog.create.mockRejectedValue(new Error('db down'));
    await expect(service.logBestEffort(entry)).resolves.toBeUndefined();
  });

  it('logRequired writes the audit row on the happy path', async () => {
    await expect(service.logRequired(entry)).resolves.toBeUndefined();
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('logRequired throws a safe ServiceUnavailable error on audit DB failure', async () => {
    prisma.auditLog.create.mockRejectedValue(
      new Error('db down: column "secret_value" leaked detail'),
    );

    await expect(service.logRequired(entry)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    // Безпечне повідомлення — без внутрішніх деталей БД.
    await expect(service.logRequired(entry)).rejects.toThrow(
      'Audit log unavailable',
    );
  });
});
