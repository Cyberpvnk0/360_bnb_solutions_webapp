/**
 * Rental listing data access for the Deal Finder. Mock-backed today —
 * generated lazily per market; swap the bodies for the live listings API
 * without touching any component.
 */

import { MARKETS } from "@/lib/mock/markets";
import { allRentals, totalRentalCount } from "@/lib/mock/rentals";
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
