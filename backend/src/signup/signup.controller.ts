import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { SignupDto } from './dto';
import { SignupService } from './signup.service';
import { AccountThrottlerGuard } from '../throttler/account-throttler.guard';

@Controller('signup')
export class SignupController {
  constructor(private signupService: SignupService) {}

  // IP-вимір: 5/60с (@Throttle). Акаунт-вимір: 5/60с на нормалізований email
  // (AccountThrottlerGuard) — обмежує масову реєстрацію на одну адресу з різних IP.
  @Post()
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(AccountThrottlerGuard)
  signup(@Body() body: SignupDto) {
    return this.signupService.signup(body.name, body.email, body.password);
  }
}
