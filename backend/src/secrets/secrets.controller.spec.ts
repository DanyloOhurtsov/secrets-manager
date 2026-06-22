import { Test, TestingModule } from '@nestjs/testing';
import { SecretsController } from './secrets.controller';
import { SecretsService } from './secrets.service';

describe('SecretsController', () => {
  let controller: SecretsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SecretsController],
      providers: [{ provide: SecretsService, useValue: {} }],
    }).compile();

    controller = module.get<SecretsController>(SecretsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
