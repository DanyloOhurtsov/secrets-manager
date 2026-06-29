// Перетворення секретів з API на змінні оточення для дочірнього процесу.
// Винесено окремо (без побічних ефектів), щоб логіку можна було юніт-тестувати
// без запуску CLI.

export interface FetchedSecret {
  key: string;
  // value === null приходить, коли токен не має дозволу reveal на цей секрет.
  value: string | null;
}

export interface BuiltSecretEnv {
  // Лише секрети з реальним рядковим значенням — придатні для інжекту.
  env: Record<string, string>;
  injected: number;
  // Секрети без значення (null/undefined) — пропущені, не інжектимо.
  skipped: number;
}

/**
 * Збирає env лише з секретів, що мають рядкове значення. Секрети з value
 * null/undefined (немає дозволу reveal) ПРОПУСКАЄМО — інакше в оточення потрапив
 * би рядок "null"/"undefined". Порожній рядок ('') — валідне значення, інжектимо.
 * Самих значень тут не логуємо й не повертаємо назовні, окрім самого env.
 */
export function buildSecretEnv(secrets: FetchedSecret[]): BuiltSecretEnv {
  const env: Record<string, string> = {};
  let injected = 0;
  let skipped = 0;

  for (const secret of secrets) {
    if (typeof secret.value === 'string') {
      env[secret.key] = secret.value;
      injected++;
    } else {
      skipped++;
    }
  }

  return { env, injected, skipped };
}
