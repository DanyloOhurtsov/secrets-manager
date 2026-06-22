import { Body, Controller, Get, Post } from '@nestjs/common';
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

  @Post('login')
  @Public()
  login(@Body() body: LoginDto) {
    return this.auth.login(body.email, body.password);
  }

  @Get('me')
  me(@CurrentIdentity() identity: Identity): Identity {
    return identity;
  }
}
