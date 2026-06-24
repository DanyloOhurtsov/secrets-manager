import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentIdentity } from './current-identity.decorator';
import { Public } from './public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto';
import type { AuthPrincipal } from './auth.types';

interface Identity {
  id: string;
  name: string;
  email: string | null;
  type: string;
  isSuperadmin: boolean;
  serviceOrganizationId: string | null;
  authMethod: 'token' | 'session';
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  // Логін — найризикованіший публічний маршрут (brute force / credential
  // stuffing). Тримаємо жорсткий ліміт, як на signup: 5 спроб/60с на IP.
  // ThrottlerGuard рахує КОЖЕН запит (і вдалий, і невдалий) до обробника, тож
  // ліміт спрацьовує однаково для правильних і неправильних паролів.
  @Post('login')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  login(@Body() body: LoginDto) {
    return this.auth.login(body.email, body.password);
  }

  // Відкликає поточну browser-сесію (logout). Session-only: для API-токенів
  // AuthService.logout кидає 400 і токен НЕ чіпає. Працює лише з валідним
  // bearer (глобальний AuthGuard), тож відкликати чужу сесію не можна.
  @Delete('session')
  logout(@CurrentIdentity() identity: AuthPrincipal) {
    return this.auth.logout(identity);
  }

  @Get('me')
  me(@CurrentIdentity() identity: AuthPrincipal): Identity {
    // Назовні віддаємо лише публічні поля — внутрішній sessionId не світимо.
    return {
      id: identity.id,
      name: identity.name,
      email: identity.email,
      type: identity.type,
      isSuperadmin: identity.isSuperadmin,
      serviceOrganizationId: identity.serviceOrganizationId,
      authMethod: identity.authMethod,
    };
  }
}
