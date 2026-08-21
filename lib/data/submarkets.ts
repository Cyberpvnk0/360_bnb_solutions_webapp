/**
 * Submarket data access. Mock-backed today — lazily generated per market,
 * so nothing pays for 6.6k rows until a screen asks for them.
 */

import { MARKET_BY_SLUG, MARKETS } from "@/lib/mock/markets";
import {
  allSubmarkets,
  submarketsFor,
  totalSubmarketCount,
} from "@/lib/mock/submarkets";
import type { Submarket } from "@/lib/mock/types";
import { simulateLatency } from "./latency";

/** Submarkets of one market, ranked by margin of safety. */
export async function getSubmarkets(marketSlug: string): Promise<Submarket[]> {
  await simulateLatency();
  const market = MARKET_BY_SLUG.get(marketSlug);
  if (!market) return [];
  return [...submarketsFor(market)].sort(
    (a, b) =>
      b.occupancy - b.avgBreakeven2br - (a.occupancy - a.avgBreakeven2br)
  );
}

/** Every submarket nationwide (~6.6k lean rows; generated once). */
export async function getAllSubmarkets(): Promise<Submarket[]> {
  await simulateLatency(600);
  return allSubmarkets();
}

/** Dataset totals for the explorer header. */
export async function getCoverageTotals(): Promise<{
  markets: number;
  submarkets: number;
}> {
  await simulateLatency(60);
  return { markets: MARKETS.length, submarkets: totalSubmarketCount() };
}
