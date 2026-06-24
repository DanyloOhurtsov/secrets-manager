import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { SignupDto } from './dto';
import { SignupService } from './signup.service';

@Controller('signup')
export class SignupController {
  constructor(private signupService: SignupService) {}

  @Post()
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  signup(@Body() body: SignupDto) {
    return this.signupService.signup(body.name, body.email, body.password);
  }
}
