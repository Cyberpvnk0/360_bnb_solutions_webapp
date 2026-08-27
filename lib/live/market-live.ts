/**
 * A market's real numbers, on demand.
 *
 * Every ADR, occupancy and RevPAR in the markets explorer is seeded —
 * deterministic from a `kind`, plausible, and entirely invented. That
 * was honest while no live source existed. One does: a coordinate
 * resolves to a market, and that market has published figures.
 *
 * COST IS THE WHOLE DESIGN. Two billed calls per market, times 409
 * markets, times however often it refreshes, is not a number to
 * discover after the fact. So nothing is pre-fetched: a market costs
 * money the first time someone opens it and not before, and the answer
 * is kept in the durable store for as long as the TTL allows. A market
 * nobody visits costs nothing, forever.
 *
 * Falls back silently to the seeded figures whenever the feed is
 * missing, capped, unreachable or incomplete. The caller says which it
 * got; the two are never blended, because a card showing a real ADR
 * against an invented occupancy is worse than one showing neither.
 */

import {
  fetchMarketIdentity,
  fetchMarketSummary,
  hasAirRoiKey,
  type MarketSummary,
} from "@/lib/live/airroi";
import { checkLiveSearch, commitLiveSearch } from "@/lib/live/quota";
import type { Market } from "@/lib/mock/types";

export interface LiveMarket {
  summary: MarketSummary;
  /** What the feed calls this place — ZIP-granular, e.g.
   *  "32202, Jacksonville, Florida, United States". Worth showing: it
   *  says how wide the figures actually are. */
  fullName: string | null;
  asOf: string;
}

/**
 * A summary is only usable if it carries the two figures every screen
 * reads. A partial one would leave a card mixing a live rate with a
 * seeded occupancy, which reads as one measurement and is two.
 */
function complete(s: MarketSummary | null): s is MarketSummary {
  return s !== null && s.adr !== null && s.adr > 0 && s.occupancy !== null;
}

export async function fetchLiveMarket(market: Market): Promise<LiveMarket | null> {
  if (!hasAirRoiKey()) return null;

  // One slot for the pair: the lookup exists only to address the
  // summary, so charging the budget twice for one answer would make the
  // cap mean something different here than everywhere else.
  const key = `market:${market.slug}`;
  if (!checkLiveSearch(key).allowed) return null;

  try {
    const identity = await fetchMarketIdentity({
      lat: market.lat,
      lon: market.lon,
    });
    if (!identity.market) return null;

    const summary = await fetchMarketSummary(identity.market);
    if (!complete(summary)) return null;

    commitLiveSearch(key);
    return {
      summary,
      fullName: identity.fullName,
      asOf: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
