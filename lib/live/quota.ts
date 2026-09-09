/**
 * Daily ceilings on what the vendors are asked — ALL OFF UNLESS SET.
 *
 * The limits a person meets are the ones their plan sets, per account,
 * in lib/db/usage: analyses a month, markets a month. Nothing app-wide
 * refuses a paying student what their plan includes. Every ledger in
 * this file is a brake an operator may choose to add with one
 * environment variable — a vendor bill to hold, a runaway to stop —
 * and with the variable unset the ledger counts and never refuses.
 * The first live search of a second market used to fail with "daily
 * limit reached" because the rentals feed's ceiling defaulted to one
 * market a day, sized to a free tier nobody is on; that default is
 * gone, and so are the others.
 *
 * This first ledger: distinct live searches for the per-area vendors —
 * the furnished search, the STR market pulls, the comps behind an
 * analysis.
 *
 * NOT THE RENTALS FEED. That one has its own ledger further down, and
 * the reason is a plan mismatch this ledger used to paper over: its
 * default of fifty a day was sized to RentCast's free tier, which is
 * fifty a MONTH. One busy day spent the whole month, and every market
 * search after that failed until the calendar rolled. Meanwhile four
 * vendors on four different plans were metered off this one number, so
 * lowering it to protect RentCast would have strangled the other three.
 * Each vendor now answers to its own plan.
 *
 * Per-area responses cache for 24 hours, so the real cost driver is how
 * many DISTINCT areas get searched in a day, not how many people search
 * them. This counts exactly that: the first search of an area reserves
 * a slot; every repeat that day rides the cache for free.
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

/** No ceiling: every check passes and `remaining` is unbounded. */
export const UNCAPPED = Number.POSITIVE_INFINITY;

/** A ceiling from an environment variable, or none at all. A junk or
 *  missing value is "no cap" rather than a cautious guess, because a
 *  guess is a limit nobody chose and the first person to hit it is a
 *  paying student. */
function capFromEnv(name: string): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : UNCAPPED;
}

export function dailyCap(): number {
  return capFromEnv("LIVE_SEARCH_DAILY_CAP");
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
 * Off unless SCRAPERAPI_DAILY_ENRICH_CAP names a figure. For sizing
 * one: a protected page is ~11 credits on the cheap path but several
 * times that when it needs JS rendering, so 200 properties is
 * somewhere between ~2k and ~15k credits a day; a probe run tells you
 * which end of that range you're actually on.
 */
export function enrichCap(): number {
  return capFromEnv("SCRAPERAPI_DAILY_ENRICH_CAP");
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
 * so this is a guard rather than a lock. Google's quota is the lock —
 * and, with IMAGERY_DAILY_CAP unset, the only one.
 */
export function imageryCap(): number {
  return capFromEnv("IMAGERY_DAILY_CAP");
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

/* ------------------------------------------------------------------ */
/* Listing contacts: a ceiling on PAGES read for a phone number        */
/* ------------------------------------------------------------------ */

/**
 * Contact details come off the listing's own page, one page per
 * property somebody actually opens, and each page is a billed scrape.
 *
 * That is a fundamentally different spend shape from the market search
 * beside it: a market is one request for five hundred rows, while this
 * is one request for ONE row, and a student clicking through a grid can
 * spend a hundred of them in an afternoon without noticing. Hence its
 * own ceiling rather than a share of the enrichment one — a runaway
 * here must not be able to eat the budget that answers "is it
 * furnished" for a whole market.
 *
 * Counted per DISTINCT LISTING per day, because that is what bills: the
 * vendor's answer for one page is cached a month and shared by everyone
 * on the deployment, so the second student to open the same property
 * costs nothing and must not consume budget either.
 *
 * Same scope caveat as the ledgers above: server memory, per instance,
 * so this is a guard rather than a lock. Off unless CONTACT_DAILY_CAP
 * is set.
 */
export function contactCap(): number {
  return capFromEnv("CONTACT_DAILY_CAP");
}

let contacted: Ledger = { day: "", keys: new Set() };

function currentContacted(now: Date): Ledger {
  const day = dayKey(now);
  if (contacted.day !== day) contacted = { day, keys: new Set() };
  return contacted;
}

/**
 * Claim today's budget for one listing page, or learn there is none
 * left. Reserves rather than checks, for the same reason reserveImage
 * does: the caller is about to spend money.
 */
export function reserveContact(key: string, now = new Date()): QuotaCheck {
  const cap = contactCap();
  const { keys } = currentContacted(now);
  const cached = keys.has(key);
  const allowed = cached || keys.size < cap;
  if (allowed && !cached) keys.add(key);
  return { allowed, cached, remaining: Math.max(0, cap - keys.size), cap };
}

/** Tests only. */
export function resetContactLedger(): void {
  contacted = { day: "", keys: new Set() };
}

/* ------------------------------------------------------------------ */
/* Listing-page joins: a ceiling on MARKETS backfilled                 */
/* ------------------------------------------------------------------ */

/**
 * The join that gives each row its listing page reads the portal's
 * search several pages deep, and every page is a billed scrape. On the
 * fresh-fetch path that spend is already bounded — the live-search cap
 * above gates it. On the BACKFILL path it is not: a market whose stored
 * rows predate the join is served out of the store, which is the whole
 * point of the store, and never passes the gate on its way.
 *
 * That is fine at forty credits a market and much less fine at a
 * hundred and twenty. So the backfill gets its own daily ceiling, in
 * markets rather than credits, because markets are what it spends.
 *
 * A market refused today is not broken: its rows still show, and its
 * cards still link out through the fallback search. It simply waits its
 * turn tomorrow. Slow is the correct failure mode for a migration. Off
 * unless JOIN_DAILY_CAP is set.
 */
export function joinCap(): number {
  return capFromEnv("JOIN_DAILY_CAP");
}

let joined: Ledger = { day: "", keys: new Set() };

function currentJoined(now: Date): Ledger {
  const day = dayKey(now);
  if (joined.day !== day) joined = { day, keys: new Set() };
  return joined;
}

/** Claim today's budget for one market's backfill, or learn there is
 *  none left. Reserves rather than checks: the caller is about to
 *  spend, and a check followed by a spend overshoots under load. */
export function reserveJoin(slug: string, now = new Date()): QuotaCheck {
  const cap = joinCap();
  const { keys } = currentJoined(now);
  const cached = keys.has(slug);
  const allowed = cached || keys.size < cap;
  if (allowed && !cached) keys.add(slug);
  return { allowed, cached, remaining: Math.max(0, cap - keys.size), cap };
}

/** Tests only. */
export function resetJoinLedger(): void {
  joined = { day: "", keys: new Set() };
}

/* ------------------------------------------------------------------ */
/* The rentals feed: a ceiling sized to a MONTHLY plan                 */
/* ------------------------------------------------------------------ */

/**
 * RentCast's allowance is quoted per month — fifty on the free tier —
 * and this product's ledgers are per day. The two were reconciled by
 * assuming they were the same number, which is how one afternoon of
 * browsing could spend a month.
 *
 * So the feed gets its own ledger, and when a plan is stated the DAILY
 * cap is DERIVED: the monthly allowance spread across the month, never
 * under one. State the plan in RENTCAST_MONTHLY_REQUESTS and the daily
 * figure follows; RENTCAST_DAILY_CAP overrides it outright for the case
 * where you know better than the arithmetic. State neither and the
 * feed has no ceiling here at all — which is the default, because the
 * old one (fifty a month, the free tier, so one market a day) refused
 * the second market anybody opened.
 *
 * Under one is never right, so the floor is one: a cap of zero would
 * mean the feed never answers, which reads as an outage rather than a
 * budget.
 *
 * Same shape as the ledger above — check first, commit on success, so a
 * failed request costs nothing — and the same per-instance caveat.
 */

/** Days a month is budgeted over. Thirty-one, so the allowance holds
 *  in the longest month rather than running two days short in it. */
const DAYS_PER_MONTH = 31;

export function rentcastMonthlyCap(): number {
  return capFromEnv("RENTCAST_MONTHLY_REQUESTS");
}

export function rentcastDailyCap(): number {
  const explicit = capFromEnv("RENTCAST_DAILY_CAP");
  if (explicit !== UNCAPPED) return explicit;
  const monthly = rentcastMonthlyCap();
  return monthly === UNCAPPED
    ? UNCAPPED
    : Math.max(1, Math.floor(monthly / DAYS_PER_MONTH));
}

let rentcast: Ledger = { day: "", keys: new Set() };

function currentRentcast(now: Date): Ledger {
  const day = dayKey(now);
  if (rentcast.day !== day) rentcast = { day, keys: new Set() };
  return rentcast;
}

/** May this area be fetched from the rentals feed right now? Doesn't
 *  consume anything. */
export function checkRentcastSearch(key: string, now = new Date()): QuotaCheck {
  const cap = rentcastDailyCap();
  const { keys } = currentRentcast(now);
  const cached = keys.has(key);
  return {
    allowed: cached || keys.size < cap,
    cached,
    remaining: Math.max(0, cap - keys.size),
    cap,
  };
}

/** Record a SUCCESSFUL feed request. Failures never consume a slot. */
export function commitRentcastSearch(key: string, now = new Date()): QuotaCheck {
  const cap = rentcastDailyCap();
  const l = currentRentcast(now);
  l.keys.add(key);
  return {
    allowed: true,
    cached: false,
    remaining: Math.max(0, cap - l.keys.size),
    cap,
  };
}

/** What the feed has spent and has left today, without claiming any
 *  of it. `used` is stated outright because cap minus remaining is not
 *  a number when there is no cap. */
export function rentcastBudget(
  now = new Date()
): QuotaCheck & { monthly: number; used: number } {
  const cap = rentcastDailyCap();
  const { keys } = currentRentcast(now);
  return {
    allowed: keys.size < cap,
    cached: false,
    remaining: Math.max(0, cap - keys.size),
    cap,
    monthly: rentcastMonthlyCap(),
    used: keys.size,
  };
}

/** Tests only. */
export function resetRentcastLedger(): void {
  rentcast = { day: "", keys: new Set() };
}
