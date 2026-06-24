/** Перетворює "діє N днів" на абсолютний момент протермінування. */
export function expiryFromDays(days?: number | null): Date | null {
  if (!days) return null;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt;
}
