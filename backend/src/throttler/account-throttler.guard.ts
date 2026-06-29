import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ThrottlerException, ThrottlerStorage } from '@nestjs/throttler';
import { createHash } from 'node:crypto';

// Жорсткий ліміт на акаунт-вимір (email) для чутливих публічних маршрутів.
// Збігається з per-route IP-лімітом (5/60с), але рахується в ОКРЕМОМУ вимірі.
const ACCOUNT_LIMIT = 5;
const ACCOUNT_TTL_MS = 60_000;
const ACCOUNT_THROTTLER_NAME = 'account';

/**
 * Нормалізує поданий email для ключа throttling: trim + lowercase.
 * Рахуємо за САМЕ поданим значенням (не звіряючись із БД), тож невідомі й
 * відомі email потрапляють в один і той самий бакет — це не виказує, чи існує
 * акаунт. Повертає null, якщо придатного рядка нема (тоді акаунт-вимір
 * пропускаємо, а IP-throttler і ValidationPipe все одно відпрацюють).
 */
export function normalizeAccountEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

// Вузькі типи замість any від switchToHttp() — нам потрібні лише body.email та
// res.header (тіло парситься middleware ще до guard'ів).
interface ThrottledRequest {
  body?: { email?: unknown };
}
interface ThrottledResponse {
  header?: (name: string, value: string | number) => unknown;
}

/**
 * Додатковий вимір rate-limiting для login/signup: ліміт за нормалізованим
 * email НА ДОДАТОК до глобального IP-throttler. Захищає від credential
 * stuffing на один акаунт із багатьох IP (NAT/проксі/ботнет), де IP-ключ
 * сам по собі слабкий.
 *
 * Використовує те саме спільне ThrottlerStorage (Redis у проді), тож ліміт
 * діє між усіма інстансами бекенду. При 429 кидаємо такий самий
 * ThrottlerException, що й IP-throttler, — відповідь не відрізняє існуючий
 * акаунт від неіснуючого.
 */
@Injectable()
export class AccountThrottlerGuard implements CanActivate {
  constructor(
    @Inject(ThrottlerStorage) private readonly storage: ThrottlerStorage,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ThrottledRequest>();
    const res = context.switchToHttp().getResponse<ThrottledResponse>();

    const email = normalizeAccountEmail(req.body?.email);
    if (!email) return true;

    // Бакет прив'язуємо до конкретного маршруту (controller+handler), щоб
    // login і signup НЕ ділили один лічильник на той самий email. Email
    // хешуємо — у Redis не лежить плейнтекст адреси.
    const scope = `${context.getClass().name}-${context.getHandler().name}`;
    const key = createHash('sha256')
      .update(`account:${scope}:${email}`)
      .digest('hex');

    const { totalHits, timeToExpire, isBlocked, timeToBlockExpire } =
      await this.storage.increment(
        key,
        ACCOUNT_TTL_MS,
        ACCOUNT_LIMIT,
        ACCOUNT_TTL_MS,
        ACCOUNT_THROTTLER_NAME,
      );

    if (isBlocked) {
      if (typeof res.header === 'function') {
        res.header('Retry-After', timeToBlockExpire);
      }
      throw new ThrottlerException();
    }

    if (typeof res.header === 'function') {
      res.header('X-RateLimit-Account-Limit', ACCOUNT_LIMIT);
      res.header(
        'X-RateLimit-Account-Remaining',
        Math.max(0, ACCOUNT_LIMIT - totalHits),
      );
      res.header('X-RateLimit-Account-Reset', timeToExpire);
    }
    return true;
  }
}
