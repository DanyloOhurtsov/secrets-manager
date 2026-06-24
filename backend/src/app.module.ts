import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { AuditModule } from './audit/audit.module';
import { CacheModule } from './cache/cache.module';
import { ThrottlingModule } from './throttler/throttling.module';
import { RedisThrottlerStorage } from './throttler/redis-throttler-storage';
import { OrganizationsModule } from './organizations/organizations.module';
import { ProjectsModule } from './projects/projects.module';
import { EnvironmentsModule } from './environments/environments.module';
import { SecretsModule } from './secrets/secrets.module';
import { GrantsModule } from './grants/grants.module';
import { ServiceAccountsModule } from './service-accounts/service-accounts.module';
import { AccountModule } from './account/account.module';
import { AdminModule } from './admin/admin.module';
import { SignupModule } from './signup/signup.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlingModule,
    // Лише один глобальний throttler (IP-вимір). Жорсткіші ліміти вмикаємо
    // точково через @Throttle({ default: {...} }) на конкретних маршрутах —
    // другий root-throttler застосовувався б глобально до всіх роутів.
    // Сховище — Redis (RedisThrottlerStorage), тож IP-ліміти спільні між
    // інстансами; при недоступності Redis сховище деградує до in-memory.
    // Акаунт-вимір (email) для login/signup додає AccountThrottlerGuard.
    ThrottlerModule.forRootAsync({
      imports: [ThrottlingModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [{ name: 'default', ttl: 60000, limit: 100 }],
        storage,
      }),
    }),
    AuthModule,
    AuditModule,
    CacheModule,
    OrganizationsModule,
    ProjectsModule,
    EnvironmentsModule,
    SecretsModule,
    GrantsModule,
    ServiceAccountsModule,
    AccountModule,
    AdminModule,
    SignupModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
