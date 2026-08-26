/**
 * Which markets a warming run should touch.
 *
 * Pure and hour-keyed so the hourly schedule walks the whole list
 * without any stored cursor: run N takes the next slice after run
 * N-1's, wrapping. Everything underneath is cached for a day, so
 * re-warming a market later in the same day costs cache reads, not
 * vendor requests — the rotation only decides who pays the daily cold
 * cost, and the answer is "the schedule, before anyone is awake".
 */
export function warmSlice(
  slugs: readonly string[],
  hourUtc: number,
  perRun = 2
): string[] {
  if (slugs.length === 0) return [];
  const start = (hourUtc * perRun) % slugs.length;
  return Array.from(
    { length: Math.min(perRun, slugs.length) },
    (_, i) => slugs[(start + i) % slugs.length]
  );
}

/** WARM_MARKETS="jacksonville,tampa,orlando" — unset means the warmer
 *  is off, because every listed market spends vendor credits daily and
 *  that is a bill someone should choose, not inherit. */
export function warmList(): string[] {
  return (process.env.WARM_MARKETS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
