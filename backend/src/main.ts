import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { applySecurityHeaders } from './security';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Trust proxy для коректного req.ip за реверс-проксі/інгресом — від цього
  // залежить IP-вимір rate-limiting. ВМИКАЄМО ЛИШЕ ЯВНО через TRUST_PROXY і
  // лише коли перед застосунком стоїть ДОВІРЕНИЙ проксі, який САМ виставляє/
  // перезаписує X-Forwarded-For. Інакше клієнти могли б підробити заголовок і
  // обійти IP-throttling. Значення:
  //   - число (напр. "1") — скільки проксі-хопів довіряти (рекомендовано);
  //   - "true"/"false" — довіряти всім / нікому (на відкритій мережі НЕ "true");
  //   - інше (підмережа/IP-список) — передається в Express як є.
  // Без TRUST_PROXY поведінка лишається дефолтною (довіри нема) — безпечно.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy !== undefined && trustProxy !== '') {
    const hops = Number(trustProxy);
    if (!Number.isNaN(hops)) {
      app.set('trust proxy', hops);
    } else if (trustProxy === 'true' || trustProxy === 'false') {
      app.set('trust proxy', trustProxy === 'true');
    } else {
      app.set('trust proxy', trustProxy);
    }
  }

  // Захисні заголовки (helmet + вузький CSP) — до решти конфігурації, щоб
  // діяли на всі відповіді. CORS не вмикаємо (лишаємо same-origin only).
  applySecurityHeaders(app);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
