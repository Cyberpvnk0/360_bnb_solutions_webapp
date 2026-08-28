/**
 * A market's KPIs: stored if fresh, fetched if not, seeded if neither.
 *
 * The read-through in one place, because the order matters and getting
 * it wrong costs money rather than correctness. Store first — a row
 * already paid for serves every later visitor free, across deploys and
 * instances. Feed second, and only for a market someone actually
 * opened. Seeded last, and openly.
 */

import { fetchLiveMarket } from "@/lib/live/market-live";
import {
  isFresh,
  readMarketStore,
  writeMarketStats,
  type StoredMarketStats,
} from "@/lib/db/market-store";
import type { Market } from "@/lib/mock/types";

export interface MarketStats {
  stats: StoredMarketStats;
  /** When these figures were fetched — never dressed up as now. */
  asOf: string;
  /** True when they were already in the store, so no call was made. */
  fromStore: boolean;
}

export async function marketStats(market: Market): Promise<MarketStats | null> {
  const stored = await readMarketStore(market.slug);
  if (stored?.stats && isFresh(stored.statsAt)) {
    return {
      stats: stored.stats,
      asOf: stored.statsAt ?? new Date().toISOString(),
      fromStore: true,
    };
  }

  const live = await fetchLiveMarket(market);
  if (!live) return null;

  const stats: StoredMarketStats = {
    ...live.summary,
    fullName: live.fullName,
    // A district means the feed answered about a ZIP, not a city. The
    // row has to carry which, or two rows written by two different
    // routes stop being comparable without anyone noticing.
    scope: live.ref.district ? "zip" : "city",
    ...(live.monthly.length > 0 ? { monthly: live.monthly } : {}),
  };
  // Write, but never let a storage failure cost the answer we just
  // bought — the store is an accelerator, not a dependency.
  await writeMarketStats(market.slug, stats).catch(() => {});
  return { stats, asOf: live.asOf, fromStore: false };
}
