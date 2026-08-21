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

export interface LiveRentalsResult {
  /** True when the rows are today's actual inventory (RentCast). */
  live: boolean;
  /** Server timestamp of the live fetch. */
  asOf?: string;
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
  try {
    const res = await fetch(
      `/api/rentals?market=${encodeURIComponent(marketSlug)}`
    );
    if (res.ok) {
      const data = (await res.json()) as LiveRentalsResult;
      if (data.live && Array.isArray(data.listings)) {
        registerLiveListings(data.listings);
        return data;
      }
    }
  } catch {
    // fall through to the preview inventory
  }
  const market = MARKET_BY_SLUG.get(marketSlug);
  return { live: false, listings: market ? rentalsFor(market) : [] };
}
