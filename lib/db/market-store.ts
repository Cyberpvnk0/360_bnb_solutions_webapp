/**
 * The durable copy of a market's day: its feed listings and its measured
 * figures, one row per market in Supabase, plus a keyed table for what
 * belongs to a property rather than a market.
 *
 * Before this, every cache lived inside the framework's fetch cache —
 * real, but bound to a deployment and invisible to the next one, so a
 * deploy re-chilled every market that had ever been searched. A row
 * here survives deploys and spans serverless instances, so the first
 * student to search a market pays for it and everyone after them —
 * across deploys, across instances — rides for free until it ages out.
 *
 * Plain fetch against Supabase's REST layer, no SDK — the same posture
 * as every other vendor in lib/live, and one less dependency to audit.
 * The service key is server-only env; nothing here ever runs in a
 * browser.
 *
 * Every function degrades to a no-op: unconfigured, unreachable, or
 * erroring storage must never fail a search that could have been served
 * live. The store is an accelerator, not a dependency.
 */

import type { LiveMarketMonth } from "@/lib/live/airroi";
import type { RentalListing } from "@/lib/mock/types";

/**
 * How long a stored day counts as current.
 *
 * A day by default, matching the vendors' own cache windows. Raise it
 * with STORE_TTL_HOURS when vendor credits are scarce: every hour of
 * TTL is a market that doesn't get re-fetched, and rental inventory
 * does not turn over fast enough for a two- or three-day-old set to be
 * wrong so much as slightly behind — which the honest asOf timestamp
 * already says out loud.
 *
 * This is now the ONLY thing standing between a popular market and a
 * fresh bill every time someone opens it: nothing pre-fetches any
 * more, so the TTL alone decides how often a searched market is
 * re-bought.
 */
export const STORE_TTL_MS = (() => {
  const raw = Number(process.env.STORE_TTL_HOURS);
  const hours = Number.isFinite(raw) && raw > 0 ? Math.min(24 * 30, raw) : 24;
  return hours * 60 * 60 * 1000;
})();

/**
 * How long a stored MARKET SUMMARY counts as current.
 *
 * Separate from STORE_TTL_MS, and much longer, because the two things
 * age at completely different rates. Rental inventory turns over — a
 * listing gone in three days is a listing somebody drives to and finds
 * leased. A market's trailing-twelve-month ADR and occupancy barely
 * move week to week; the vendor's own cache header for market
 * endpoints is seven days against one day for comps, which is them
 * saying the same thing.
 *
 * Sharing one TTL made a backfill nearly pointless: buy 75 markets
 * cheaply overnight, and the first page view of each one 24 hours later
 * re-bought it at full price. A day of measured figures for $13.50, and
 * then the same bill again tomorrow.
 *
 * STATS_TTL_HOURS overrides it. Capped at 30 days, like its sibling.
 */
export const STATS_TTL_MS = (() => {
  const raw = Number(process.env.STATS_TTL_HOURS);
  const hours = Number.isFinite(raw) && raw > 0 ? Math.min(24 * 30, raw) : 24 * 7;
  return hours * 60 * 60 * 1000;
})();

const READ_TIMEOUT_MS = 4_000;
const WRITE_TIMEOUT_MS = 8_000;

/**
 * One property's comp pull, kept.
 *
 * The most expensive recurring call in the product: every analysis of
 * every address, at a per-call price measured in tens of cents rather
 * than the hundredth of a dollar the vendor's floor suggested. It was
 * held only in the framework's cache, which is bound to a deployment —
 * so a push threw away every comp set anyone had paid for, and with
 * thousands of students the same address gets bought again and again.
 */
export interface StoredEstimate {
  comps: unknown[];
  monthlyRevenue: number[] | null;
  revenue: number | null;
  adr: number | null;
  occupancy: number | null;
}

/** A market's live KPIs, as stored. Shape mirrors the feed's summary
 *  so a schema change surfaces here rather than three screens later. */
export interface StoredMarketStats {
  adr: number | null;
  occupancy: number | null;
  revpar: number | null;
  revenue: number | null;
  activeListings: number | null;
  bookingLeadTime: number | null;
  lengthOfStay: number | null;
  /** What the feed calls this place, at its own granularity. */
  fullName: string | null;
  /**
   * How wide these figures are.
   *
   * "zip" came from a coordinate lookup and covers the ZIP the market's
   * centre falls in; "city" was addressed by name and covers the whole
   * locality. Same endpoint, same fields, genuinely different areas —
   * so a row that does not say which is a row nobody can compare.
   * Absent on rows written before the distinction existed.
   */
  scope?: "zip" | "city";
  /**
   * Twelve months of history, when the feed had it.
   *
   * Deliberately inside this jsonb rather than in a column of its own:
   * the stats column already exists, and every new column is a
   * migration somebody has to run before the deploy that needs it —
   * which is exactly the trap the tolerant read had to be written
   * around last time.
   */
  monthly?: LiveMarketMonth[];
}

export interface StoredMarket {
  listings: RentalListing[] | null;
  listingsAt: string | null;
  stats: StoredMarketStats | null;
  statsAt: string | null;
}

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  // Either name: the dashboard now issues "secret" keys (sb_secret_…)
  // where it used to issue service_role JWTs, and an env var whose name
  // doesn't match the label you copied it from is its own small trap.
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

export function storeConfigured(): boolean {
  return config() !== null;
}

/** Whether a stored timestamp is still inside the TTL. Garbage → no. */
export function isFresh(
  at: string | null | undefined,
  ttlMs = STORE_TTL_MS
): boolean {
  if (!at) return false;
  const then = Date.parse(at);
  if (!Number.isFinite(then)) return false;
  return Date.now() - then < ttlMs;
}

function headers(key: string): Record<string, string> {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
}

/** The columns every deployment has had since the table was created. */
const CORE_COLUMNS = "listings,listings_at";
/** Added later; a database that predates the migration lacks them. */
const STATS_COLUMNS = "stats,stats_at";

/**
 * Read a market's row.
 *
 * Two attempts, and the reason is worth stating: asking for a column
 * the table does not have makes PostgREST reject the WHOLE select, so
 * adding `stats` to this list would have taken the listings and photo
 * caches down with it on any deployment whose migration had not run
 * yet. A new column must never be able to break the old ones. So the
 * wide read is tried once and a narrow read answers if the schema is
 * behind — degraded, not broken, and self-healing the moment the
 * migration lands.
 */
export async function readMarketStore(
  slug: string
): Promise<StoredMarket | null> {
  const cfg = config();
  if (!cfg) return null;

  const read = (columns: string) =>
    fetch(
      `${cfg.url}/rest/v1/market_cache?market_slug=eq.${encodeURIComponent(slug)}&select=${columns}`,
      {
        headers: headers(cfg.key),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        // The row IS the cache; never let the framework cache the read.
        cache: "no-store",
      }
    );

  try {
    let res = await read(`${CORE_COLUMNS},${STATS_COLUMNS}`);
    if (!res.ok) res = await read(CORE_COLUMNS);
    if (!res.ok) return null;
    const rows = (await res.json()) as {
      listings?: RentalListing[] | null;
      listings_at?: string | null;
      stats?: StoredMarketStats | null;
      stats_at?: string | null;
    }[];
    const row = rows?.[0];
    if (!row) return null;
    return {
      listings: Array.isArray(row.listings) ? row.listings : null,
      listingsAt: row.listings_at ?? null,
      stats: row.stats ?? null,
      statsAt: row.stats_at ?? null,
    };
  } catch {
    return null;
  }
}

export interface WriteResult {
  ok: boolean;
  /** Why it failed, in the database's own words. */
  detail: string | null;
}

/**
 * Upsert one slice of a market's row. PostgREST only touches the
 * columns present in the body, which is what lets the listings writer
 * and the stats writer share a row without clobbering each other.
 *
 * REPORTS FAILURE. The first version of this fired the request and
 * returned void without looking at the response, on the reasoning that
 * a failed write costs only the acceleration it would have bought.
 * That reasoning is right for a cache and badly wrong for anything
 * that spent money to produce the value being stored: a backfill
 * resolved markets, called the write, saw no error, and reported five
 * markets stored when the column did not exist and nothing had been
 * saved at all. Fifteen billed calls, discarded, reported as success.
 *
 * Callers on the request path may still ignore the result — that is
 * the cache case, and it is a choice they make out loud. Callers that
 * paid for the data must not.
 */
async function upsert(body: Record<string, unknown>): Promise<WriteResult> {
  const cfg = config();
  if (!cfg) return { ok: false, detail: "no store configured" };
  try {
    const res = await fetch(`${cfg.url}/rest/v1/market_cache`, {
      method: "POST",
      headers: {
        ...headers(cfg.key),
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([body]),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) return { ok: true, detail: null };
    const detail = (await res.text().catch(() => ""))
      .replace(/\s+/g, " ")
      .slice(0, 240);
    return { ok: false, detail: detail || `HTTP ${res.status}` };
  } catch {
    return { ok: false, detail: "unreachable or timed out" };
  }
}

export async function writeMarketListings(
  slug: string,
  listings: RentalListing[]
): Promise<WriteResult> {
  return upsert({
    market_slug: slug,
    listings,
    listings_at: new Date().toISOString(),
  });
}


/**
 * How much is actually in the store.
 *
 * The in-memory call counter cannot answer "is caching working": it
 * lives in one instance's memory, and the request that spent a call and
 * the request that reads the counter routinely land on different
 * instances. Row counts do not have that problem — there is one
 * database, and it either has the row or it does not.
 *
 * Counts only. No content leaves this function.
 */
export async function storeCounts(): Promise<{
  markets: number;
  marketsWithStats: number;
  keyed: number;
  error: string | null;
}> {
  const empty = { markets: 0, marketsWithStats: 0, keyed: 0 };
  const cfg = config();
  if (!cfg) return { ...empty, error: "no store configured" };

  /**
   * The count from PostgREST's Content-Range header.
   *
   * NO Range header. Asking for rows 0-0 of an empty table is answered
   * 416 Range Not Satisfiable, which made every empty table report as
   * unreachable — collapsing "nothing stored yet" and "no such table"
   * into one number, which is the precise confusion this function was
   * added to prevent. `limit=1` gets the same count with no such edge.
   *
   * A 416 is still tolerated below, because being wrong about this
   * twice would be careless.
   */
  const count = async (table: string, query = ""): Promise<number> => {
    const res = await fetch(
      `${cfg.url}/rest/v1/${table}?select=*&limit=1${query}`,
      {
        headers: { ...headers(cfg.key), prefer: "count=exact" },
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        cache: "no-store",
      }
    );
    // 416 means the range was unsatisfiable, which for a count means
    // there was nothing to range over.
    if (res.status === 416) return 0;
    if (!res.ok) return -1;
    // "0-0/12", or "*/0" when the table is empty.
    const total = Number((res.headers.get("content-range") ?? "").split("/")[1]);
    return Number.isFinite(total) ? total : -1;
  };

  try {
    const [markets, marketsWithStats, keyed] = await Promise.all([
      count("market_cache"),
      count("market_cache", "&stats=not.is.null"),
      count("listing_cache"),
    ]);
    return {
      markets,
      marketsWithStats,
      keyed,
      error:
        markets < 0 || keyed < 0
          ? "a table did not answer — it may not exist, or the key may lack access"
          : null,
    };
  } catch {
    return { ...empty, error: "unreachable or timed out" };
  }
}

type StatsRows = Map<string, { stats: StoredMarketStats; at: string | null }>;

/**
 * KPI rows from the store, in one query.
 *
 * Reading them one market at a time would be a round trip per card;
 * fetching them from the vendor instead would be a billed call per
 * card. One request costs one round trip and nothing at the vendor:
 * whatever has already been paid for shows measured figures, and
 * everything else keeps its modelled ones.
 */
async function readStatsWhere(filter: string | null): Promise<StatsRows> {
  const out: StatsRows = new Map();
  const cfg = config();
  if (!cfg) return out;

  const query = [filter, "stats=not.is.null", "select=market_slug,stats,stats_at"]
    .filter(Boolean)
    .join("&");

  try {
    const res = await fetch(`${cfg.url}/rest/v1/market_cache?${query}`, {
      headers: headers(cfg.key),
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      cache: "no-store",
    });
    // A schema without the column rejects the whole select, exactly as
    // the single-row read had to be taught. An empty map is the right
    // answer: every caller falls back to the seeded model.
    if (!res.ok) return out;
    const rows = (await res.json()) as {
      market_slug?: string;
      stats?: StoredMarketStats | null;
      stats_at?: string | null;
    }[];
    for (const row of rows ?? []) {
      if (row.market_slug && row.stats) {
        out.set(row.market_slug, { stats: row.stats, at: row.stats_at ?? null });
      }
    }
    return out;
  } catch {
    return out;
  }
}

/** Every stored KPI row. The backfill's view: what is already paid for. */
export async function readAllMarketStats(): Promise<StatsRows> {
  return readStatsWhere(null);
}

/**
 * Stored KPI rows for a named set of markets.
 *
 * What one operator's desk needs: the handful of markets they watch or
 * hold deals in, not the catalogue. Reading everything to draw three
 * rows would grow the page's payload with the store rather than with
 * the person looking at it — and the store is meant to grow.
 *
 * Slugs are filtered to the safe character set before interpolation.
 * They come from our own catalogue rather than a text box, but a query
 * built by string concatenation should not depend on that staying true.
 */
export async function readMarketStatsFor(slugs: string[]): Promise<StatsRows> {
  const safe = [...new Set(slugs)].filter((s) => /^[a-z0-9-]{1,64}$/i.test(s));
  if (safe.length === 0) return new Map();
  return readStatsWhere(`market_slug=in.(${safe.join(",")})`);
}

/**
 * A market's live KPIs.
 *
 * Two billed calls produced these, so losing them to a deployment is
 * two calls thrown away per market — across 409 markets that is the
 * kind of arithmetic that turns a plan into a monthly surprise.
 */
export async function writeMarketStats(
  slug: string,
  stats: StoredMarketStats
): Promise<WriteResult> {
  return upsert({
    market_slug: slug,
    stats,
    stats_at: new Date().toISOString(),
  });
}

/* ------------------------------------------------------------------ */
/* Keyed JSON cache — listing details and property estimates           */
/* ------------------------------------------------------------------ */

/**
 * A cache key for one property's comp pull.
 *
 * Coordinates rounded to about a hundred metres, because two analyses a
 * few doors apart draw the same comps and paying twice for them is a
 * choice. Bedrooms, baths and guests are part of the key since they
 * change the query the vendor answers.
 *
 * Prefixed and stored in the same keyed table as listing details: both
 * are "a text key holding a JSON blob with a timestamp", the table
 * already exists, and inventing a second one would mean another
 * migration that has to land before the deploy that needs it.
 */
export function estimateKey(spec: {
  lat: number;
  lon: number;
  bedrooms: number;
  baths: number;
  guests: number;
}): string {
  const round = (n: number) => n.toFixed(3);
  return `estimate:${round(spec.lat)},${round(spec.lon)}:${spec.bedrooms}:${spec.baths}:${spec.guests}`;
}

/* ------------------------------------------------------------------ */
/* Listing details — the expensive rows                                */
/* ------------------------------------------------------------------ */

/**
 * A listing detail costs ten credits, against one for a whole page of
 * search results. It was the last thing in the system cached only by
 * the framework, which means bound to a deployment: every push threw
 * the lot away and the next student to open the same listing bought it
 * again. On a day of active deploys that is the entire credit bill,
 * spent on pages already paid for.
 *
 * Keyed by listing URL rather than market, because a detail belongs to
 * a property and students open the same handful across every market.
 *
 * Same posture as the rest of this file: degrade to null, never throw,
 * never fail a request that could still be served live.
 */
/** Read any keyed blob from the shared cache table. */
async function readKeyed<T>(
  key: string,
  usable: (value: unknown) => value is T
): Promise<{ value: T; at: string | null } | null> {
  const cfg = config();
  if (!cfg) return null;
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/listing_cache?listing_url=eq.${encodeURIComponent(key)}&select=detail,detail_at`,
      {
        headers: headers(cfg.key),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { detail?: unknown; detail_at?: string | null }[];
    const row = rows?.[0];
    if (!row || !usable(row.detail)) return null;
    return { value: row.detail, at: row.detail_at ?? null };
  } catch {
    return null;
  }
}

function isEstimate(value: unknown): value is StoredEstimate {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as StoredEstimate).comps)
  );
}

export async function readEstimate(
  key: string
): Promise<{ estimate: StoredEstimate; at: string | null } | null> {
  const hit = await readKeyed(key, isEstimate);
  return hit ? { estimate: hit.value, at: hit.at } : null;
}

export async function writeEstimate(
  key: string,
  estimate: StoredEstimate
): Promise<WriteResult> {
  return writeKeyed(key, estimate);
}

/* ------------------------------------------------------------------ */
/* Redfin city ids — looked up once, ever                              */
/* ------------------------------------------------------------------ */

/**
 * A resolved city id, kept.
 *
 * Redfin addresses a city by an opaque number that cannot be derived
 * from its name, and resolving one means a slow bypass request against
 * an undocumented endpoint. Before this it was memoised per instance,
 * which means re-paid on every deploy and by every cold lambda — so the
 * Furnished filter was quietly buying the same three-second answer over
 * and over for the two hundred and fifty markets not in the static map.
 *
 * Stored as {id: null} when the lookup came back with nothing, because
 * a market Redfin genuinely does not have is an answer worth keeping
 * too. It just does not keep as long: see CITY_ID_MISS_TTL_MS.
 */
export interface StoredCityId {
  id: number | null;
}

/** A found id is permanent — Redfin's ids do not change. */
export const CITY_ID_HIT_TTL_MS = 365 * 24 * 60 * 60 * 1000;
/**
 * A miss is not. It might be a market Redfin has never carried, or it
 * might be one bad night at the resolver, and those look identical from
 * here. A week means a transient failure costs a week of a degraded
 * filter rather than forever.
 */
export const CITY_ID_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long this answer keeps, given what it says.
 *
 * Pure and exported because the asymmetry is the whole design and it is
 * the thing a later reader will be tempted to flatten into one number.
 * Flattening it either way is a bug: one TTL for both means a bad night
 * at the resolver is remembered for a year, or an id that never changes
 * is re-bought every week.
 */
export function cityIdTtlMs(stored: StoredCityId): number {
  return stored.id === null ? CITY_ID_MISS_TTL_MS : CITY_ID_HIT_TTL_MS;
}

function cityIdKey(slug: string): string {
  return `redfin-city:${slug}`;
}

function isCityId(value: unknown): value is StoredCityId {
  if (!value || typeof value !== "object") return false;
  const id = (value as StoredCityId).id;
  return id === null || (typeof id === "number" && Number.isFinite(id));
}

/**
 * The stored id for a market, or null when nothing usable is stored.
 *
 * Returns `{id: null}` for a remembered miss inside its TTL — which is
 * a different answer from "nothing stored", and the caller must treat
 * it as one or the negative caching does nothing.
 */
export async function readCityId(slug: string): Promise<StoredCityId | null> {
  const hit = await readKeyed(cityIdKey(slug), isCityId);
  if (!hit) return null;
  return isFresh(hit.at, cityIdTtlMs(hit.value)) ? hit.value : null;
}

export async function writeCityId(
  slug: string,
  id: number | null
): Promise<WriteResult> {
  return writeKeyed(cityIdKey(slug), { id });
}


/**
 * Write any keyed blob to the shared cache table.
 *
 * Property estimates and resolved city ids both live here. Listing
 * detail used to as well — photos and amenities scraped from a listing's
 * own page — and this was named for that. It is not scraped any more,
 * and a function named for a thing it no longer stores is a small lie
 * every reader has to see through.
 */
export async function writeKeyed(
  key: string,
  value: unknown
): Promise<WriteResult> {
  const cfg = config();
  if (!cfg) return { ok: false, detail: "no store configured" };
  try {
    const res = await fetch(`${cfg.url}/rest/v1/listing_cache`, {
      method: "POST",
      headers: {
        ...headers(cfg.key),
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([
        {
          listing_url: key,
          detail: value,
          detail_at: new Date().toISOString(),
        },
      ]),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) return { ok: true, detail: null };
    // Not `detail`: that is this function's own parameter, and
    // shadowing it reads as a typo whichever one you meant.
    const why = (await res.text().catch(() => ""))
      .replace(/\s+/g, " ")
      .slice(0, 240);
    return { ok: false, detail: why || `HTTP ${res.status}` };
  } catch {
    return { ok: false, detail: "unreachable or timed out" };
  }
}

/**
 * Which Supabase variables this deployment can see, names only.
 *
 * Names, never values — a diagnostic that leaks a secret key to
 * whoever loads the URL is worse than the confusion it solves. A
 * misspelled variable is invisible to a "did you set it?" question and
 * obvious the moment the actual names are listed.
 */
function describePresent(): string {
  const seen = Object.keys(process.env).filter((k) => /SUPA?BASE/i.test(k));
  return seen.length > 0 ? seen.sort().join(", ") : "no SUPABASE_* variables at all";
}

/**
 * What KIND of key this is, from its own shape. Never its value.
 *
 * The single most useful fact when the store misbehaves, and the one
 * the health check kept guessing at. "The key lacks privileged access"
 * is a hypothesis; "this is a publishable key" is the answer, and it
 * costs nothing to read — the kind is written on the front of the key.
 *
 * Two generations in the wild: the new sb_secret_ / sb_publishable_
 * prefixes, and the older JWTs whose unverified payload carries a role
 * claim. Decoding a payload without verifying it is fine here: we are
 * reading our OWN key to describe it, not trusting a token.
 */
export function describeKeyKind(key: string): string {
  if (key.startsWith("sb_secret_")) return "secret (sb_secret_…)";
  if (key.startsWith("sb_publishable_")) return "PUBLISHABLE (sb_publishable_…)";
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf8")
      ) as { role?: string };
      if (payload.role === "service_role") return "service_role JWT";
      if (payload.role) return `${payload.role.toUpperCase()} JWT`;
      return "JWT with no role claim";
    } catch {
      return "unreadable JWT";
    }
  }
  return "unrecognised format";
}

/** True for a key that can be relied on to bypass row level security. */
function keyIsPrivileged(key: string): boolean {
  const kind = describeKeyKind(key);
  return kind.startsWith("secret") || kind === "service_role JWT";
}

/** A slug no market will ever have, so the check writes nothing real. */
const HEALTH_SLUG = "__healthcheck__";

export interface StoreStatus {
  ok: boolean;
  detail: string;
}

/**
 * Whether the store can actually be used, answered by using it.
 *
 * A write followed by a read, because that is the only thing that
 * settles the question the setup actually raises: does THIS key have
 * privileged access? A key without it doesn't necessarily error — with
 * row level security on and no policies, an under-privileged key can
 * return a cheerful empty result forever, which reads as "working" from
 * a status code alone. Writing a sentinel row and reading it back can't
 * be faked by an empty answer.
 *
 * Diagnostic only. Everything on the hot path stays silent by design;
 * this is the one place that says why.
 */
export async function storeStatus(): Promise<StoreStatus> {
  const cfg = config();
  if (!cfg) {
    // Name the one that is missing. "Not configured" for a two-variable
    // setup sends someone to re-check the variable they already got
    // right — which is exactly what it did.
    const missing = [
      process.env.SUPABASE_URL ? null : "SUPABASE_URL",
      process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
        ? null
        : "SUPABASE_SECRET_KEY",
    ].filter(Boolean);
    return {
      ok: false,
      detail:
        `Not configured — missing ${missing.join(" and ")}. ` +
        `Present: ${describePresent()}. ` +
        "SUPABASE_URL is the dashboard's Project URL (https://<ref>.supabase.co); " +
        "SUPABASE_SECRET_KEY is the secret key, not the publishable one. " +
        "Env changes only reach a NEW deployment — redeploy after adding them.",
    };
  }

  const stamp = new Date().toISOString();
  let write: Response;
  try {
    write = await fetch(`${cfg.url}/rest/v1/market_cache`, {
      method: "POST",
      headers: { ...headers(cfg.key), prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([{ market_slug: HEALTH_SLUG, listings_at: stamp }]),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, detail: "Unreachable — check SUPABASE_URL." };
  }

  if (!write.ok) {
    const body = (await write.text().catch(() => "")).slice(0, 400);

    /**
     * The database's own diagnosis, before any of ours.
     *
     * A 403 here was reported as "a publishable key cannot write here;
     * use the secret key", which sent someone to check a key that was
     * correct. The real cause was Postgres 42501 — the right key,
     * authenticating as the right role, on tables that role had never
     * been granted anything on. Postgres said so, and included the
     * exact GRANT to run; our guess printed over it.
     *
     * So the specific codes are read first, and a guess is only offered
     * where there is nothing better.
     */
    let hint: string;
    if (body.includes("42501")) {
      hint =
        "the key is fine but its role has no rights on the table — run the GRANT in the hint below";
    } else if (write.status === 404 || body.includes("42P01")) {
      hint = "that table does not exist — create it before this can store anything";
    } else if (write.status === 401 || write.status === 403) {
      hint =
        "the key was rejected — check it is the secret key rather than the publishable one";
    } else {
      hint = "see the body";
    }
    return { ok: false, detail: `Write failed ${write.status}: ${hint}. ${body}` };
  }

  const back = await readMarketStore(HEALTH_SLUG);
  if (back?.listingsAt !== stamp) {
    const kind = describeKeyKind(cfg.key);
    // Say WHICH problem, from the key's own shape, rather than
    // asserting the likeliest one. A publishable key and a privileged
    // key that cannot SELECT produce the same symptom and need
    // completely different fixes, and guessing sent somebody to check
    // a key that was already correct once before.
    return {
      ok: false,
      detail: keyIsPrivileged(cfg.key)
        ? `Wrote without error but read nothing back, and SUPABASE_SECRET_KEY is a ${kind} — so the key is the right kind and the problem is the table. Either the row was never really written, or this role can INSERT but not SELECT. Re-run supabase/schema.sql: it is idempotent and grants both.`
        : `SUPABASE_SECRET_KEY holds a ${kind}, not a secret key. The cache tables have row level security on and NO policies on purpose, so a publishable key can write nothing and read nothing back. Copy the SECRET key from Supabase → Project Settings → API keys, replace the value in Vercel, and redeploy.`,
    };
  }
  return {
    ok: true,
    detail: `Read and wrote a sentinel row with a ${describeKeyKind(cfg.key)}.`,
  };
}
