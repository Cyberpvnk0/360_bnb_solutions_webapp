/**
 * Server-side resolution of a LIVE listing id back into a full Analysis.
 *
 * Live rows are registered in browser memory when Deal Finder fetches
 * them, but /analyze renders on the server, where that memory doesn't
 * exist. The market slug is encoded in the id (`r--live--{slug}--{feedId}`),
 * so this re-reads that market from the feed — a Data Cache hit within
 * the same 24 hours, costing no new RentCast request — and rebuilds the
 * listing's analysis with the same comp-backed math a seeded pull gets.
 *
 * Server only: it reads the API key. Never import from a client component.
 */

import { analysisForListing } from "@/lib/mock/analyses";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import type { Analysis } from "@/lib/mock/types";
import { fetchRedfinRentals } from "./redfin";
import { fetchLiveRentals } from "./rentcast";

const LIVE_PREFIX = "r--live--";

export function isLiveAnalysisId(id: string): boolean {
  return id.startsWith(LIVE_PREFIX);
}

export async function resolveLiveAnalysis(
  id: string
): Promise<Analysis | null> {
  if (!isLiveAnalysisId(id)) return null;
  const rest = id.slice(LIVE_PREFIX.length);
  // Slugs never contain "--", so the first split is the market.
  const sep = rest.indexOf("--");
  if (sep < 1) return null;
  const market = MARKET_BY_SLUG.get(rest.slice(0, sep));
  if (!market) return null;

  // Redfin rows carry an `rf-` feed id and come from a different feed;
  // reading RentCast for one would simply never find it.
  const fromRedfin = rest.slice(sep + 2).startsWith("rf-");

  try {
    const listings = fromRedfin
      ? (await fetchRedfinRentals(market, { furnished: true })).listings
      : await fetchLiveRentals(market);
    const listing = listings.find((l) => l.analysisId === id);
    return listing ? analysisForListing(listing) : null;
  } catch {
    return null;
  }
}
