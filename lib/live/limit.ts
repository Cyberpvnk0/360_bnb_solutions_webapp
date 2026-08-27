/**
 * One gate for every request to the scraping vendor.
 *
 * The plan meters CONCURRENCY, not just volume: exceed the thread count
 * and everything past it is answered 429. Each caller here used to keep
 * its own limit and each was individually polite — then two paginated
 * passes ran their waves side by side, peaked over the line, and the
 * vendor shot one down. The pass that lost the race died whole, and a
 * catch dressed the throttle up as "no results". A limit only works if
 * everything shares it, so it lives in module scope and every vendor
 * fetch goes through it.
 *
 * WHY THE DEFAULT IS WELL UNDER THE PLAN'S NUMBER. This counter is
 * per-instance, and a serverless deployment runs several instances at
 * once. The vendor counts the fleet; this gate counts one process. So
 * the true ceiling is roughly the default times however many instances
 * happen to be warm, and setting it to the plan's full thread count
 * guarantees breaching it the moment a second instance wakes up.
 *
 * Six against a twenty-thread plan leaves room for three concurrent
 * instances before anything is at risk, which is double the old
 * setting and still conservative. SCRAPER_CONCURRENCY overrides it; the
 * hard ceiling matches the plan rather than the old one, so an upgrade
 * is a config change and not a code change.
 */

/** The plan's thread count — the most a single instance may ever ask
 *  for, even when someone sets the variable higher. */
const PLAN_THREADS = 20;

const MAX = (() => {
  const raw = Number(process.env.SCRAPER_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0
    ? Math.min(PLAN_THREADS, Math.floor(raw))
    : 6;
})();

/** The cap in force. Exported so a test can assert the invariant —
 *  "never more than the cap" — instead of a number that has to be
 *  edited every time the plan changes. */
export const scraperConcurrency = MAX;

let active = 0;
const waiting: (() => void)[] = [];

export async function withScraperSlot<T>(job: () => Promise<T>): Promise<T> {
  while (active >= MAX) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active += 1;
  try {
    return await job();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}
