import { Controller, Get, Header } from '@nestjs/common';
import { AppService } from './app.service';
import type { ApiHealth, ApiInfo } from './app.service';
import { API_LANDING_STYLES, renderApiLandingPage } from './api-landing';
import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Public()
  @Header('Content-Type', 'text/html; charset=utf-8')
  getLandingPage(): string {
    return renderApiLandingPage(this.appService.getInfo());
  }

  @Get('api.css')
  @Public()
  @Header('Content-Type', 'text/css; charset=utf-8')
  getLandingStyles(): string {
    return API_LANDING_STYLES;
  }

  @Get('info')
  @Public()
  getInfo(): ApiInfo {
    return this.appService.getInfo();
  }

  @Get('health')
  @Public()
  getHealth(): ApiHealth {
    return this.appService.getHealth();
  }
}
