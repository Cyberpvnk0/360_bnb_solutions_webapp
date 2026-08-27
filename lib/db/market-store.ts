/**
 * The durable copy of a market's day: its feed listings and its photo
 * merge, one row per market in Supabase.
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

const READ_TIMEOUT_MS = 4_000;
const WRITE_TIMEOUT_MS = 8_000;

export interface StoredPhotoMerge {
  photos: Record<string, string>;
  extras: RentalListing[];
  matched: number;
  rows: number;
}

/**
 * One listing's mined detail, durably.
 *
 * Photos and flags only — never the vendor's paragraph. The prose is
 * mined for facts inside the fetch and dropped there, and a store that
 * quietly kept a copy would undo that rule in the one place nobody
 * looks.
 */
export interface StoredListingDetail {
  photos: string[];
  amenities: string[];
  features: string[];
  depositMin?: number;
  depositMax?: number;
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
}

export interface StoredMarket {
  listings: RentalListing[] | null;
  listingsAt: string | null;
  photoMerge: StoredPhotoMerge | null;
  photoMergeAt: string | null;
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

export async function readMarketStore(
  slug: string
): Promise<StoredMarket | null> {
  const cfg = config();
  if (!cfg) return null;
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/market_cache?market_slug=eq.${encodeURIComponent(slug)}&select=listings,listings_at,photo_merge,photo_merge_at,stats,stats_at`,
      {
        headers: headers(cfg.key),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        // The row IS the cache; never let the framework cache the read.
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as {
      listings?: RentalListing[] | null;
      listings_at?: string | null;
      photo_merge?: StoredPhotoMerge | null;
      photo_merge_at?: string | null;
      stats?: StoredMarketStats | null;
      stats_at?: string | null;
    }[];
    const row = rows?.[0];
    if (!row) return null;
    return {
      listings: Array.isArray(row.listings) ? row.listings : null,
      listingsAt: row.listings_at ?? null,
      photoMerge: row.photo_merge ?? null,
      photoMergeAt: row.photo_merge_at ?? null,
      stats: row.stats ?? null,
      statsAt: row.stats_at ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Upsert one slice of a market's row. PostgREST only touches the
 * columns present in the body, which is what lets the listings writer
 * and the photo writer share a row without clobbering each other.
 */
async function upsert(body: Record<string, unknown>): Promise<void> {
  const cfg = config();
  if (!cfg) return;
  try {
    await fetch(`${cfg.url}/rest/v1/market_cache`, {
      method: "POST",
      headers: {
        ...headers(cfg.key),
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([body]),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // A write that fails cost nothing but the acceleration it would
    // have bought. The next request simply computes again.
  }
}

export async function writeMarketListings(
  slug: string,
  listings: RentalListing[]
): Promise<void> {
  await upsert({
    market_slug: slug,
    listings,
    listings_at: new Date().toISOString(),
  });
}

export async function writeMarketPhotoMerge(
  slug: string,
  merge: StoredPhotoMerge
): Promise<void> {
  await upsert({
    market_slug: slug,
    photo_merge: merge,
    photo_merge_at: new Date().toISOString(),
  });
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
): Promise<void> {
  await upsert({
    market_slug: slug,
    stats,
    stats_at: new Date().toISOString(),
  });
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
export async function readListingDetail(
  listingUrl: string
): Promise<{ detail: StoredListingDetail; at: string | null } | null> {
  const cfg = config();
  if (!cfg) return null;
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/listing_cache?listing_url=eq.${encodeURIComponent(listingUrl)}&select=detail,detail_at`,
      {
        headers: headers(cfg.key),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as {
      detail?: StoredListingDetail | null;
      detail_at?: string | null;
    }[];
    const row = rows?.[0];
    if (!row?.detail || !Array.isArray(row.detail.photos)) return null;
    return { detail: row.detail, at: row.detail_at ?? null };
  } catch {
    return null;
  }
}

export async function writeListingDetail(
  listingUrl: string,
  detail: StoredListingDetail
): Promise<void> {
  const cfg = config();
  if (!cfg) return;
  try {
    await fetch(`${cfg.url}/rest/v1/listing_cache`, {
      method: "POST",
      headers: {
        ...headers(cfg.key),
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([
        {
          listing_url: listingUrl,
          detail,
          detail_at: new Date().toISOString(),
        },
      ]),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // Same as above: a failed write costs only the saving it would
    // have made.
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
    const body = (await write.text().catch(() => "")).slice(0, 200);
    const hint =
      write.status === 401 || write.status === 403
        ? "the key was rejected — a publishable key cannot write here; use the secret key"
        : write.status === 404
          ? "no market_cache table — run supabase/schema.sql in the SQL editor"
          : "see the body";
    return { ok: false, detail: `Write failed ${write.status}: ${hint}. ${body}` };
  }

  const back = await readMarketStore(HEALTH_SLUG);
  if (back?.listingsAt !== stamp) {
    return {
      ok: false,
      detail:
        "Wrote without error but read nothing back — the key lacks privileged access, so row level security is hiding the row it just wrote.",
    };
  }
  return { ok: true, detail: "Read and wrote a sentinel row." };
}
