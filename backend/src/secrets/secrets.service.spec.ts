import { Test, TestingModule } from '@nestjs/testing';
import { SecretsService } from './secrets.service';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { AuthorizationService } from '../auth/authorization.service';
import { AuditService } from '../audit/audit.service';

describe('SecretsService', () => {
  let service: SecretsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretsService,
        { provide: PrismaService, useValue: {} },
        { provide: CryptoService, useValue: {} },
        { provide: AuthorizationService, useValue: {} },
        { provide: AuditService, useValue: {} },
      ],
    }).compile();

    service = module.get<SecretsService>(SecretsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
