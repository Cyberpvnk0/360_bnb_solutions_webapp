/**
 * The durable copy of a market's day: its feed listings and its photo
 * merge, one row per market in Supabase.
 *
 * Before this, every cache lived inside the framework's fetch cache —
 * real, but bound to a deployment and invisible to the next one, so a
 * deploy re-chilled every market and the warming cron's work evaporated
 * with it. A row here survives deploys, spans serverless instances, and
 * makes a warmed market instant for as long as the row is fresh.
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

/** Matches the vendors' own cache windows: a stored day is a day. */
export const STORE_TTL_MS = 24 * 60 * 60 * 1000;

const READ_TIMEOUT_MS = 4_000;
const WRITE_TIMEOUT_MS = 8_000;

export interface StoredPhotoMerge {
  photos: Record<string, string>;
  extras: RentalListing[];
  matched: number;
  rows: number;
}

export interface StoredMarket {
  listings: RentalListing[] | null;
  listingsAt: string | null;
  photoMerge: StoredPhotoMerge | null;
  photoMergeAt: string | null;
}

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
      `${cfg.url}/rest/v1/market_cache?market_slug=eq.${encodeURIComponent(slug)}&select=listings,listings_at,photo_merge,photo_merge_at`,
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
    }[];
    const row = rows?.[0];
    if (!row) return null;
    return {
      listings: Array.isArray(row.listings) ? row.listings : null,
      listingsAt: row.listings_at ?? null,
      photoMerge: row.photo_merge ?? null,
      photoMergeAt: row.photo_merge_at ?? null,
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
