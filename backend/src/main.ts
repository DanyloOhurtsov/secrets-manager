import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { applySecurityHeaders } from './security';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
