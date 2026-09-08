/**
 * The plan month, as a key. Its own file because the browser needs it
 * too — to read this period's meter — and lib/db/usage is server-only.
 * UTC, so every instance and every student agree on when it rolls.
 */
export function currentPeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}
