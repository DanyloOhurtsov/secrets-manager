import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { applySecurityHeaders } from './security';

// M4: підтверджуємо, що applySecurityHeaders ставить очікувані захисні заголовки.
// Піднімаємо мінімальний застосунок (лише AppController) — без БД, тож e2e не треба.
describe('security headers (M4)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    app = moduleRef.createNestApplication();
    applySecurityHeaders(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets a restrictive Content-Security-Policy', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    const csp = res.headers['content-security-policy'];

    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    // Жодних небезпечних послаблень.
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('default-src *');
  });

  it('sets X-Content-Type-Options and X-Frame-Options', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    // helmet за замовчуванням також віддає X-Frame-Options: DENY (на додачу до
    // frame-ancestors 'none' у CSP) — захист від клікджекінгу для старих браузерів.
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('does not leak a permissive Access-Control-Allow-Origin (CORS left untouched)', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
