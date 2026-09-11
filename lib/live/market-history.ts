/**
 * A market's twelve measured months, bought on its own.
 *
 * The headline figures and the year are two different calls to the
 * feed, and a backfill run at the cheap setting buys only the first —
 * which is the right trade for four hundred markets and leaves every
 * one of their pages with a chart and nothing in it. This buys the
 * second, for one market, when somebody actually wants to look at it.
 *
 * KEPT UNDER ITS OWN KEY, NOT MERGED INTO THE STATS ROW. Writing it
 * back into the stats would stamp that row as measured today, and it
 * was not: the headline figures would quietly get a new date and a new
 * thirty days of freshness off the back of a call that had nothing to
 * do with them. A separate blob keeps each one's age its own.
 *
 * CITY-WIDE, ALWAYS, AND FOR ONE CALL. The series is asked for with the
 * market's own country/region/locality, which costs nothing to build
 * and covers the whole city. Resolving the feed's ZIP first would be a
 * second billed call to narrow a chart that is read for its shape.
 * Where a market's headline row was measured at ZIP scope the tiles
 * already say so.
 */

import {
  fetchMarketMetrics,
  hasAirRoiKey,
  type LiveMarketMonth,
} from "@/lib/live/airroi";
import { catalogueRef } from "@/lib/live/market-live";
import { checkLiveSearch, commitLiveSearch } from "@/lib/live/quota";
import {
  isFresh,
  readKeyedBlob,
  STATS_TTL_MS,
  writeKeyed,
} from "@/lib/db/market-store";
import type { Market } from "@/lib/mock/types";

export function historyKey(marketSlug: string): string {
  return `history:${marketSlug}`;
}

export interface MarketHistory {
  months: LiveMarketMonth[];
  at: string | null;
}

function isMonth(value: unknown): value is LiveMarketMonth {
  if (!value || typeof value !== "object") return false;
  const m = value as LiveMarketMonth;
  return (
    typeof m.month === "string" &&
    typeof m.adr === "number" &&
    Number.isFinite(m.adr) &&
    typeof m.occupancy === "number" &&
    Number.isFinite(m.occupancy)
  );
}

/** The stored year, if one is on file and still fresh. */
export async function readMarketHistory(
  marketSlug: string
): Promise<MarketHistory | null> {
  const stored = await readKeyedBlob(historyKey(marketSlug)).catch(() => null);
  if (!stored || !isFresh(stored.at, STATS_TTL_MS)) return null;
  const months = Array.isArray(stored.value.months)
    ? stored.value.months.filter(isMonth)
    : [];
  return months.length > 0 ? { months, at: stored.at } : null;
}

export type BuyHistoryResult =
  | { ok: true; months: LiveMarketMonth[]; at: string; bought: boolean }
  | { ok: false; reason: "no-key" | "quota" | "not-found" | "failed" };

/**
 * Buy one market's year and keep it.
 *
 * Returns a failure rather than throwing, because the caller's next act
 * is to decide whether to charge for this — and nothing that failed
 * should ever be charged for.
 */
export async function buyMarketHistory(
  market: Market
): Promise<BuyHistoryResult> {
  if (!hasAirRoiKey()) return { ok: false, reason: "no-key" };
  const key = historyKey(market.slug);
  if (!checkLiveSearch(key).allowed) return { ok: false, reason: "quota" };

  try {
    const months = await fetchMarketMetrics(catalogueRef(market));
    // A chart of three months is not a year, and the empty state is a
    // better answer than a stub somebody has to squint at.
    if (months.length < 6) return { ok: false, reason: "not-found" };
    const at = new Date().toISOString();
    commitLiveSearch(key);
    // Never let a storage failure cost the answer just paid for.
    await writeKeyed(key, { months }).catch(() => {});
    return { ok: true, months, at, bought: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
