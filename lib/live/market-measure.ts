/** Headline facts addressed by the catalogue's city, avoiding a paid ZIP
 * lookup. The market analysis route combines this with the separately cached
 * trailing year and forward pacing, fetching only missing sections. */

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
