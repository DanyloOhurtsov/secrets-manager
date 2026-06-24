import { Global, Module } from '@nestjs/common';
import { RedisThrottlerStorage } from './redis-throttler-storage';
import { AccountThrottlerGuard } from './account-throttler.guard';

// Глобальний модуль для production-throttling:
// - RedisThrottlerStorage підставляється у ThrottlerModule як спільне сховище
//   (див. app.module.ts), щоб ліміти діяли між інстансами;
// - AccountThrottlerGuard доступний для @UseGuards на login/signup.
@Global()
@Module({
  providers: [RedisThrottlerStorage, AccountThrottlerGuard],
  exports: [RedisThrottlerStorage, AccountThrottlerGuard],
})
export class ThrottlingModule {}
