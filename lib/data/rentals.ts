/**
 * Rental listing data access for the Deal Finder. Mock-backed today —
 * generated lazily per market; swap the bodies for the live listings API
 * without touching any component.
 */

import { MARKET_BY_SLUG, MARKETS } from "@/lib/mock/markets";
import {
  allRentals,
  registerLiveListings,
  rentalsFor,
  totalRentalCount,
} from "@/lib/mock/rentals";
import type { RentalListing } from "@/lib/mock/types";
import { simulateLatency } from "./latency";

/** Every rental listing nationwide (~3.5k lean rows; generated once). */
export async function getRentals(): Promise<RentalListing[]> {
  await simulateLatency(500);
  return allRentals();
}

/** Dataset totals for the Deal Finder toolbar. */
export async function getRentalTotals(): Promise<{
  rentals: number;
  markets: number;
}> {
  await simulateLatency(60);
  return { rentals: totalRentalCount(), markets: MARKETS.length };
}

/** Why the live feed didn't answer — surfaced in the toolbar so a
 *  wrong key never looks like "no listings here". */
export type LiveFailureReason =
  | "no-key"
  | "auth"
  | "quota"
  | "http"
  | "network"
  | "bad-zip"
  | "unknown-market"
  /** This app's own daily ceiling on distinct live searches. */
  | "daily-cap";

export interface LiveRentalsResult {
  /** True when the rows are today's actual inventory (RentCast). */
  live: boolean;
  /** Server timestamp of the live fetch. */
  asOf?: string;
  /** Camera target for the searched area. */
  center?: { lat: number; lon: number } | null;
  reason?: LiveFailureReason;
  status?: number | null;
  /** Distinct live searches left today, and the ceiling itself. */
  remaining?: number;
  cap?: number;
  listings: RentalListing[];
}

/**
 * Today's actual rentals for one market, via the server route that holds
 * the RentCast key. Falls back to the seeded preview inventory when the
 * key is missing or the feed is unreachable — the caller shows which one
 * it got. Live rows are registered so "Run the numbers" resolves them.
 */
export async function getLiveRentals(
  marketSlug: string
): Promise<LiveRentalsResult> {
  const market = MARKET_BY_SLUG.get(marketSlug);
  const preview = (reason: LiveFailureReason, status?: number | null) => ({
    live: false as const,
    reason,
    status: status ?? null,
    listings: market ? rentalsFor(market) : [],
  });
  try {
    const res = await fetch(
      `/api/rentals?market=${encodeURIComponent(marketSlug)}`
    );
    const data = (await res.json().catch(() => null)) as
      | LiveRentalsResult
      | null;
    if (res.ok && data?.live && Array.isArray(data.listings)) {
      registerLiveListings(data.listings);
      return data;
    }
    return {
      ...preview(data?.reason ?? "network", data?.status),
      cap: data?.cap,
      remaining: data?.remaining,
    };
  } catch {
    return preview("network");
  }
}

export interface MarketPhotoMerge {
  /** listing id → photo URL, for rows the feed already shows. */
  photos: Record<string, string>;
  /** Complete listings the feed doesn't carry, photos welded on — the
   *  same rows the Furnished view would show. */
  listings: RentalListing[];
}

/**
 * Photos and photo-bearing listings for a market, a beat after the rows.
 *
 * A second call on purpose: the rows come back without imagery so they
 * can render as soon as the feed answers, and this fills in behind
 * them — pictures onto the rows the feed has, whole listings for the
 * ones it hasn't. Returns nothing for anything it can't cover; the
 * caller merges what it gets and leaves the rest alone.
 *
 * By id, not by address, because the address matching lives on the
 * server next to both feeds. Nothing here needs to know how two
 * vendors spell a street.
 */
export async function getMarketPhotoMerge(
  marketSlug: string
): Promise<MarketPhotoMerge> {
  const empty: MarketPhotoMerge = { photos: {}, listings: [] };
  try {
    const res = await fetch(
      `/api/rentals/photos?market=${encodeURIComponent(marketSlug)}`
    );
    if (!res.ok) return empty;
    const data = (await res.json().catch(() => null)) as {
      photos?: Record<string, string>;
      listings?: RentalListing[];
    } | null;
    const listings = Array.isArray(data?.listings) ? data.listings : [];
    // Registered like any live rows, so "Run the numbers" resolves them
    // after a navigation exactly as it does for the feed's own.
    registerLiveListings(listings);
    return { photos: data?.photos ?? {}, listings };
  } catch {
    return empty;
  }
}

export interface ZipRentalsResult extends LiveRentalsResult {
  /** The covered market anchoring cushion math for this ZIP, if any. */
  market?: string | null;
}

/**
 * Today's actual rentals for a 5-digit ZIP. ZIP search is live-only —
 * the preview world has no honest ZIP inventory — so a failure returns
 * NO rows (never a nationwide dump) and the caller explains why.
 */
export async function getLiveRentalsByZip(
  zip: string
): Promise<ZipRentalsResult> {
  try {
    const res = await fetch(`/api/rentals?zip=${encodeURIComponent(zip)}`);
    const data = (await res.json().catch(() => null)) as
      | ZipRentalsResult
      | null;
    if (res.ok && data?.live && Array.isArray(data.listings)) {
      registerLiveListings(data.listings);
      return data;
    }
    return {
      live: false,
      reason: data?.reason ?? "network",
      status: data?.status ?? null,
      cap: data?.cap,
      remaining: data?.remaining,
      listings: [],
    };
  } catch {
    return { live: false, reason: "network", status: null, listings: [] };
  }
}
