import { Controller, Get } from '@nestjs/common';
import { CurrentIdentity } from './current-identity.decorator';

interface Identity {
  id: string;
  name: string;
  type: string;
  isSuperadmin: boolean;
}

@Controller('auth')
export class AuthController {
  @Get('me')
  me(@CurrentIdentity() identity: Identity): Identity {
    return identity;
  }
}
