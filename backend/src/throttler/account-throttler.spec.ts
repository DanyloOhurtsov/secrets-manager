import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';

// L6: окремий, account-aware вимір throttling на login (5/60с за нормалізованим
// email) ПОВЕРХ IP-ліміту. Доводимо, що:
//   1) однаковий email обмежується навіть із РІЗНИХ IP (де IP-ключ безсилий);
//   2) різні email мають окремі бакети (один не блокує інший);
//   3) per-IP route-ліміт продовжує діяти, навіть коли email змінюється.
//
// Підіймаємо лише AuthController + справжній ThrottlerGuard. AccountThrottlerGuard
// під'єднано на маршруті через @UseGuards і автоматично резолвиться сканером
// як injectable модуля; його ThrottlerStorage бере з ThrottlerModule (in-memory
// у тесті — той самий контракт, що й Redis у проді).
describe('AuthController account-aware login throttling (L6)', () => {
  let app: NestExpressApplication;
  const login = jest.fn();

  const PASSWORD = 'password123'; // валідний формат (>=8), щоб дійти до хендлера

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        // default IP-throttler 100/60с — НЕ блокуватиме в межах тесту, тож
        // блокування доводить саме account-вимір (а на login ще діє per-route
        // @Throttle(5/60с) на IP).
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 100 }]),
      ],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: { login } },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    // Вмикаємо trust proxy, щоб X-Forwarded-For визначав req.ip — так у тесті
    // можемо варіювати «клієнтський» IP і ізолювати account-вимір від IP-виміру.
    app.set('trust proxy', true);
    await app.init();

    login.mockReset();
    login.mockRejectedValue(
      new UnauthorizedException('Invalid email or password'),
    );
  });

  afterEach(async () => {
    await app.close();
  });

  it('throttles repeated logins for the same email even across different IPs', async () => {
    const server = app.getHttpServer();
    const email = 'victim@example.com';

    // 5 спроб із РІЗНИХ IP: кожен IP-бакет бачить лише 1 хіт, тож IP-ліміт не
    // спрацьовує — але account-бакет email накопичує 1..5.
    for (let i = 0; i < 5; i++) {
      await request(server)
        .post('/auth/login')
        .set('X-Forwarded-For', `10.0.0.${i}`)
        .send({ email, password: PASSWORD })
        .expect(401);
    }

    // 6-та спроба тим самим email із ЩЕ ОДНОГО нового IP → блокує account-guard.
    await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', '10.0.0.99')
      .send({ email, password: PASSWORD })
      .expect(429);

    // Хендлер викликали лише 5 разів — 6-ту відсік account-guard до AuthService.
    expect(login).toHaveBeenCalledTimes(5);
  });

  it('keeps a separate account bucket per email (a different email is not blocked)', async () => {
    const server = app.getHttpServer();

    // Вичерпуємо бакет для email A (різні IP, щоб не зачепити IP-ліміт).
    for (let i = 0; i < 5; i++) {
      await request(server)
        .post('/auth/login')
        .set('X-Forwarded-For', `11.0.0.${i}`)
        .send({ email: 'a@example.com', password: PASSWORD })
        .expect(401);
    }

    // 6-та спроба для email A — заблокована (його бакет вичерпано).
    await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', '11.0.0.99')
      .send({ email: 'a@example.com', password: PASSWORD })
      .expect(429);

    // А email B (новий IP) НЕ повинен потрапити в бакет A → проходить (401).
    await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', '11.0.0.50')
      .send({ email: 'b@example.com', password: PASSWORD })
      .expect(401);
  });

  it('still enforces the per-IP route limit when the email varies', async () => {
    const server = app.getHttpServer();
    const ip = '12.0.0.7';

    // Той самий IP, але РІЗНІ email щоразу: account-бакети окремі (по 1), однак
    // per-route IP-ліміт (@Throttle 5/60с) усе одно блокує 6-й запит.
    for (let i = 0; i < 5; i++) {
      await request(server)
        .post('/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: `user${i}@example.com`, password: PASSWORD })
        .expect(401);
    }

    await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'user5@example.com', password: PASSWORD })
      .expect(429);
  });
});
