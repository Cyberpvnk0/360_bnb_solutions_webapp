/**
 * One gate for every request to the scraping vendor.
 *
 * The plan meters CONCURRENCY, not just volume: five requests in
 * flight, everything past that answered 429. Each caller here kept its
 * own limit and each was individually polite — then two paginated
 * passes ran their waves side by side, peaked at six, and the vendor
 * shot one down. The pass that lost the race died whole, and a catch
 * dressed the throttle up as "no results".
 *
 * A limit only works if everything shares it, so it lives in module
 * scope and every vendor fetch goes through it. Three, because that is
 * the number this project has actually measured as safe on this plan —
 * SCRAPER_CONCURRENCY raises it after an upgrade.
 */

const MAX = (() => {
  const raw = Number(process.env.SCRAPER_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0 ? Math.min(10, Math.floor(raw)) : 3;
})();

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
