export function parseQueryList(
  value?: string | string[],
): string[] | undefined {
  if (!value) return undefined;

  const values = (Array.isArray(value) ? value : [value])
    .flatMap((item) => item.split(','))
    .map((item) => item.trim())
    .filter(Boolean);

  return values.length > 0 ? [...new Set(values)] : undefined;
}

/** Парсить дату з query. Невалідне значення ігноруємо (повертаємо undefined). */
export function parseQueryDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
