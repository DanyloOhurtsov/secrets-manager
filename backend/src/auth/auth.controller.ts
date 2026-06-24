import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentIdentity } from './current-identity.decorator';
import { Public } from './public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto';

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

  @Get('me')
  me(@CurrentIdentity() identity: Identity): Identity {
    return identity;
  }
}
