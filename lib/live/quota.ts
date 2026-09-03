/**
 * Daily ceiling on distinct live searches — the spend guard.
 *
 * RentCast bills per request, and our per-area responses cache for 24
 * hours, so the real cost driver is how many DISTINCT markets and ZIPs
 * get searched in a day, not how many people search them. This counts
 * exactly that: the first search of an area reserves a slot; every
 * repeat that day rides the cache for free and never counts again.
 *
 * A slot is only committed after a request actually succeeds, so a
 * rejected key or an unreachable feed can't eat the day's budget.
 *
 * Scope note: the ledger lives in server memory, so each running
 * instance keeps its own count. That makes this a spend GUARD, not a
 * hard billing lock — with several instances warm, the true ceiling is
 * a small multiple of the cap. Move the ledger to a shared store (Vercel
 * KV, Redis) if you ever need the cap to be exact.
 */

/** Default ceiling: RentCast's free Developer tier is 50 requests. */
export const DEFAULT_DAILY_LIVE_SEARCH_CAP = 50;

export function dailyCap(): number {
  const raw = Number(process.env.LIVE_SEARCH_DAILY_CAP);
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_DAILY_LIVE_SEARCH_CAP;
}

interface Ledger {
  day: string;
  keys: Set<string>;
}

let ledger: Ledger = { day: "", keys: new Set() };

/** UTC day — a fixed, predictable reset the whole fleet agrees on. */
function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function currentLedger(now: Date): Ledger {
  const day = dayKey(now);
  if (ledger.day !== day) ledger = { day, keys: new Set() };
  return ledger;
}

export interface QuotaCheck {
  allowed: boolean;
  /** True when this area was already fetched today — cache-served, free. */
  cached: boolean;
  /** Distinct areas still available today. */
  remaining: number;
  cap: number;
}

/** May this area be fetched live right now? Doesn't consume anything. */
export function checkLiveSearch(key: string, now = new Date()): QuotaCheck {
  const cap = dailyCap();
  const { keys } = currentLedger(now);
  const cached = keys.has(key);
  const remaining = Math.max(0, cap - keys.size);
  return { allowed: cached || keys.size < cap, cached, remaining, cap };
}

/** Record a SUCCESSFUL live fetch. Failures never consume a slot. */
export function commitLiveSearch(key: string, now = new Date()): QuotaCheck {
  const cap = dailyCap();
  const l = currentLedger(now);
  l.keys.add(key);
  return {
    allowed: true,
    cached: false,
    remaining: Math.max(0, cap - l.keys.size),
    cap,
  };
}

/** Tests only — drops today's ledger. */
export function resetLiveSearchLedger(): void {
  ledger = { day: "", keys: new Set() };
}

/* ------------------------------------------------------------------ */
/* Enrichment: a ceiling on PROPERTIES, not areas                      */
/* ------------------------------------------------------------------ */

/**
 * The area cap above can't guard ScraperAPI: every address is its own
 * billed call, so twenty-four properties in one already-counted market
 * still cost twenty-four reads. This counts the thing that actually
 * bills — properties read in a day.
 *
 * The default is deliberately cautious because the credits-per-property
 * number is unknown until measured: a protected page is ~11 credits on
 * the cheap path but several times that when it needs JS rendering, so
 * 200 properties is somewhere between ~2k and ~15k credits a day. Raise
 * SCRAPERAPI_DAILY_ENRICH_CAP once a probe run has told you which end of
 * that range you're actually on.
 */
export const DEFAULT_DAILY_ENRICH_CAP = 200;

export function enrichCap(): number {
  const raw = Number(process.env.SCRAPERAPI_DAILY_ENRICH_CAP);
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_DAILY_ENRICH_CAP;
}

let enriched: { day: string; count: number } = { day: "", count: 0 };

export interface EnrichReservation {
  /** How many of the requested properties may be read now. Partial
   *  grants are normal near the ceiling — better to enrich eighteen of
   *  a page than to refuse all twenty-four. */
  granted: number;
  remaining: number;
  cap: number;
}

/** Claim budget for `wanted` properties, up to what today has left.
 *  Counts attempts, including ones the Data Cache will serve free —
 *  conservative by design. */
export function reserveEnrichments(
  wanted: number,
  now = new Date()
): EnrichReservation {
  const cap = enrichCap();
  const day = dayKey(now);
  if (enriched.day !== day) enriched = { day, count: 0 };
  const granted = Math.max(0, Math.min(wanted, cap - enriched.count));
  enriched.count += granted;
  return { granted, remaining: Math.max(0, cap - enriched.count), cap };
}

/** Tests only. */
export function resetEnrichLedger(): void {
  enriched = { day: "", count: 0 };
}


/* ------------------------------------------------------------------ */
/* Street View images: a ceiling on ADDRESSES pictured                 */
/* ------------------------------------------------------------------ */

/**
 * Google's own daily quota is the hard stop; this is the soft one, and
 * they do different jobs.
 *
 * Theirs refuses the request, which arrives here as a failure. Ours
 * declines to ask, so the card falls straight to an aerial and a
 * student sees a roof instead of waiting on a round trip to be told
 * no. It also lives in an environment variable rather than the Cloud
 * console, so it can be moved without a second login, and it still
 * holds if somebody raises the quota over there and forgets.
 *
 * Counted per DISTINCT COORDINATE per day, because that is what bills.
 * Google's answer for one address caches thirty days and is shared by
 * everyone on the deployment, so the second student to open a listing
 * costs nothing and must not consume budget either. A market browsed
 * all afternoon spends its addresses once.
 *
 * Same scope caveat as the ledgers above: server memory, per instance,
 * so this is a guard rather than a lock. Google's quota is the lock.
 */
export const DEFAULT_DAILY_IMAGERY_CAP = 1_000;

export function imageryCap(): number {
  const raw = Number(process.env.IMAGERY_DAILY_CAP);
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_DAILY_IMAGERY_CAP;
}

let pictured: Ledger = { day: "", keys: new Set() };

function currentPictured(now: Date): Ledger {
  const day = dayKey(now);
  if (pictured.day !== day) pictured = { day, keys: new Set() };
  return pictured;
}

/**
 * Claim today's budget for one address, or learn there is none left.
 *
 * Reserves rather than checks: the caller is about to spend money, and
 * a check followed by a spend is a race that overshoots the cap on a
 * busy page. An address already pictured today is free and always
 * allowed.
 */
export function reserveImage(key: string, now = new Date()): QuotaCheck {
  const cap = imageryCap();
  const { keys } = currentPictured(now);
  const cached = keys.has(key);
  const allowed = cached || keys.size < cap;
  if (allowed && !cached) keys.add(key);
  return { allowed, cached, remaining: Math.max(0, cap - keys.size), cap };
}

/** What today has left, without claiming any of it. */
export function imageryBudget(now = new Date()): QuotaCheck {
  const cap = imageryCap();
  const { keys } = currentPictured(now);
  return {
    allowed: keys.size < cap,
    cached: false,
    remaining: Math.max(0, cap - keys.size),
    cap,
  };
}

/** Tests only. */
export function resetImageryLedger(): void {
  pictured = { day: "", keys: new Set() };
}
