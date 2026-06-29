import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';

// Базове hardening HTTP-заголовків (M4). Бекенд віддає ЛИШЕ JSON і не вантажить
// жодних зовнішніх ресурсів, тож CSP тримаємо дуже вузьким: усе — 'self', без
// wildcard і без 'unsafe-inline'. Це не замінює httpOnly-cookie для токенів
// (окремий крок, не в цьому пасі), але звужує наслідки XSS та клікджекінгу для
// будь-яких відрендерених у браузері відповідей/помилок і майбутньої статики.
//
// CORS свідомо НЕ чіпаємо: його тут немає (same-origin only) і helmet його не
// змінює. Frontend (Vite) у дев-режимі ходить до API через власний proxy, тобто
// same-origin до dev-сервера, тож вузький connect-src 'self' розробку не ламає.
export function applySecurityHeaders(app: INestApplication): void {
  app.use(
    helmet({
      contentSecurityPolicy: {
        // Повністю явна політика (без злиття з дефолтами helmet), щоб набір
        // директив був передбачуваним і його легко було аудитувати.
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          scriptSrc: ["'self'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          // upgrade-insecure-requests НАВМИСНО не вмикаємо: локальна розробка
          // йде по http, а бекенд — API-only.
        },
      },
      // Узгоджуємо legacy-заголовок із CSP frame-ancestors 'none': DENY (а не
      // дефолтний у helmet SAMEORIGIN) — повний захист від клікджекінгу.
      xFrameOptions: { action: 'deny' },
    }),
  );
  // Решта захисних заголовків — дефолти helmet: X-Content-Type-Options: nosniff,
  // X-Frame-Options: DENY, Referrer-Policy, Cross-Origin-*-Policy, HSTS тощо.
}
