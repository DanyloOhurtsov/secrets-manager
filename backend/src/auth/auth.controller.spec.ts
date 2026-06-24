import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// M1: POST /auth/login має жорсткий ліміт 5 спроб/60с (а не глобальний 100/60с).
// Піднімаємо лише контролер + справжній ThrottlerGuard (як APP_GUARD) — без БД,
// тож e2e тут не потрібен. AuthService мокаємо, щоб кожна спроба була невдалою.
describe('AuthController login throttling (M1)', () => {
  let app: INestApplication;
  const login = jest.fn();

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      // Той самий root-throttler, що й у проді (default: 100/60с), щоб довести,
      // що саме per-route @Throttle(5/60с) звужує ліміт на логіні.
      imports: [
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 100 }]),
      ],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: { login } },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Кожна спроба входу — невдала (неправильний пароль).
    login.mockReset();
    login.mockRejectedValue(
      new UnauthorizedException('Invalid email or password'),
    );
  });

  it('rate-limits repeated wrong-password logins: 6th attempt in the window returns 429', async () => {
    const server = app.getHttpServer();
    const body = { email: 'attacker@example.com', password: 'wrong-password' };

    // Перші 5 спроб доходять до обробника → 401 (невірний пароль). Троттлер
    // рахує і невдалі спроби, тож вікно заповнюється однаково для будь-якого пароля.
    for (let i = 0; i < 5; i++) {
      await request(server).post('/auth/login').send(body).expect(401);
    }

    // 6-та спроба за те саме вікно/IP — ThrottlerGuard блокує ще до обробника → 429.
    await request(server).post('/auth/login').send(body).expect(429);

    // Обробник викликали рівно 5 разів — 6-ту відсік троттлер до AuthService.
    expect(login).toHaveBeenCalledTimes(5);
  });
});
