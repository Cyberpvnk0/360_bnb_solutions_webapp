/**
 * Market data access. Mock-backed today; replace bodies with real API
 * calls without touching any component.
 */

import { MARKET_BY_SLUG, MARKETS } from "@/lib/mock/markets";
import type { Market } from "@/lib/mock/types";
import { simulateLatency } from "./latency";

export interface MarketFilters {
  states?: string[];
  minOccupancy?: number;
  minAdr?: number;
  maxAdr?: number;
  minListings?: number;
}

export async function getMarkets(filters?: MarketFilters): Promise<Market[]> {
  await simulateLatency();
  let out = MARKETS;
  if (filters) {
    out = out.filter((m) => {
      if (filters.states && filters.states.length > 0 && !filters.states.includes(m.stateCode)) return false;
      if (filters.minOccupancy !== undefined && m.occupancy < filters.minOccupancy) return false;
      if (filters.minAdr !== undefined && m.adr < filters.minAdr) return false;
      if (filters.maxAdr !== undefined && m.adr > filters.maxAdr) return false;
      if (filters.minListings !== undefined && m.activeListings < filters.minListings) return false;
      return true;
    });
  }
  return out;
}

export async function getMarket(slug: string): Promise<Market | null> {
  await simulateLatency();
  return MARKET_BY_SLUG.get(slug) ?? null;
}

/** Distinct state codes present in the dataset, for the state filter. */
export async function getMarketStates(): Promise<string[]> {
  await simulateLatency(80);
  return [...new Set(MARKETS.map((m) => m.stateCode))].sort();
}
