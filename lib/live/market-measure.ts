/**
 * A market's headline figures, bought on purpose.
 *
 * Nothing pre-fetches a market, so most of the catalogue carries a rule
 * and a researched lease and nothing else. Two things fill that in
 * today and neither is discoverable from the markets table: an analysis
 * run on a property there, and a Deal Finder search, which buys the
 * city's figures to project its cards. This is the third — a button on
 * the market itself, for somebody looking at a row of dashes and
 * wanting it filled.
 *
 * ONE CALL, BY NAME. Addressed with the market's own country, region
 * and locality, which costs nothing to build and measures the whole
 * city — the right area for a page about a city. Resolving the feed's
 * ZIP first is a second billed call that narrows the answer to the ZIP
 * the city's centre happens to fall in, which is not what the page
 * claims to be about.
 *
 * The twelve-month series is deliberately NOT fetched: it is a third
 * call, the page does not draw a chart without one, and the size table
 * answers the question a market is actually opened with for nothing.
 */

import { fetchLiveMarket } from "@/lib/live/market-live";
import {
  isFresh,
  readMarketStatsFor,
  STATS_TTL_MS,
  writeMarketStats,
  type StoredMarketStats,
} from "@/lib/db/market-store";
import type { Market } from "@/lib/mock/types";

/** The credit key for one market's figures. */
export function measureKey(marketSlug: string): string {
  return `market:${marketSlug}`;
}

export interface StoredStats {
  stats: StoredMarketStats;
  at: string | null;
}

/** This market's figures if they are on file and still fresh. */
export async function storedMarketStats(
  marketSlug: string
): Promise<StoredStats | null> {
  const row = (await readMarketStatsFor([marketSlug]).catch(() => new Map())).get(
    marketSlug
  ) as StoredStats | undefined;
  if (!row || !isFresh(row.at, STATS_TTL_MS)) return null;
  // A row of nulls is not a measurement: the feed answers with the
  // shape whether or not it had figures.
  const s = row.stats;
  const any =
    s.adr !== null ||
    s.occupancy !== null ||
    s.revenue !== null ||
    s.activeListings !== null;
  return any ? row : null;
}

export type BuyMarketResult =
  | { ok: true; stats: StoredMarketStats; at: string; bought: boolean }
  | { ok: false; reason: "no-key" | "quota" | "not-found" | "failed" };

/**
 * Buy one market's figures and keep them.
 *
 * Returns a failure rather than throwing, because the caller's next act
 * is to decide whether to charge for this — and nothing that failed
 * should ever be charged for. `fetchLiveMarket` already refuses when
 * there is no key and when the day's area ledger is spent; both come
 * back as a null it cannot tell apart, so the caller is told the one
 * thing it can act on.
 */
export async function buyMarketStats(market: Market): Promise<BuyMarketResult> {
  try {
    const live = await fetchLiveMarket(market, {
      identity: "catalogue",
      history: false,
    });
    if (!live) return { ok: false, reason: "not-found" };
    const stats: StoredMarketStats = {
      ...live.summary,
      fullName: live.fullName,
      // Addressed by name, so this covers the locality rather than a
      // ZIP — recorded, because two rows written by two routes stop
      // being comparable without it.
      scope: live.ref.district ? "zip" : "city",
    };
    // Never let a storage failure cost the answer just paid for.
    await writeMarketStats(market.slug, stats).catch(() => {});
    return { ok: true, stats, at: live.asOf, bought: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
