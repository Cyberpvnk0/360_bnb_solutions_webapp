/**
 * A market's twelve months, bought on its own.
 *
 * WHY THIS IS SEPARATE FROM MEASURING A MARKET. Opening a market buys
 * its headline figures in one billed call (lib/live/market-measure).
 * The year is a second call, and folding it into the first would double
 * the price of every market anyone so much as looks at — so it is its
 * own purchase, made by the reader who actually wants the seasonal
 * picture. `fetchLiveMarket` can fetch both together and the market
 * page reads whichever arrived; this path asks the metrics endpoint
 * directly off the catalogue's own address, which costs one call and
 * needs no summary it would only throw away.
 *
 * WHY IT IS WORTH BUYING AT ALL. Arbitrage signs a twelve-month lease
 * against revenue that does not arrive in twelve equal pieces. A market
 * that measures $60k a year and earns most of it in one season is a
 * different proposition from one that earns it evenly, and the annual
 * average — which is all the headline figures can ever say — cannot
 * tell the two apart. This is the call that can.
 *
 * Kept under its own key in the shared blob store, so the first account
 * to buy a market's year buys it for everybody after.
 */

import {
  fetchMarketMonths,
  hasAirRoiKey,
  type LiveMarketMonth,
} from "@/lib/live/airroi";
import { catalogueRef } from "@/lib/live/market-live";
import {
  isFresh,
  readKeyedBlob,
  writeKeyed,
  STATS_TTL_MS,
} from "@/lib/db/market-store";
import type { Market } from "@/lib/mock/types";

/**
 * How long a bought year stands.
 *
 * The same window the headline figures use, and for the same reason:
 * the series is a TRAILING twelve months, so it shifts by one month a
 * month and no faster. Re-buying it more often than that is paying for
 * an answer that has not changed.
 */
export const HISTORY_TTL_MS = STATS_TTL_MS;

/** The store key and the credit key for one market's year. */
export function historyKey(marketSlug: string): string {
  return `market-months:${marketSlug}`;
}

/**
 * Read a stored year back out of an untyped blob.
 *
 * TOLERANT ON PURPOSE. This reads rows written by earlier deploys and
 * by a feed that may reshape under us; a month missing its revenue is
 * still a month worth drawing, and one missing its rate is not a month
 * at all. Rows that do not survive are dropped rather than mapped to
 * zero, because a zero on a chart reads as a measurement.
 */
export function readMonths(value: unknown): LiveMarketMonth[] {
  const rows = Array.isArray(value)
    ? value
    : Array.isArray((value as { months?: unknown } | null)?.months)
      ? ((value as { months: unknown[] }).months)
      : [];
  const out: LiveMarketMonth[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const month = typeof r.month === "string" ? r.month : null;
    const adr = typeof r.adr === "number" && Number.isFinite(r.adr) ? r.adr : null;
    const occupancy =
      typeof r.occupancy === "number" && Number.isFinite(r.occupancy)
        ? r.occupancy
        : null;
    if (!month || adr === null || occupancy === null) continue;
    const num = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    out.push({ month, adr, occupancy, revenue: num(r.revenue), revpar: num(r.revpar) });
  }
  // Oldest first, so the chart reads left to right whatever order the
  // feed answered in.
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

export interface StoredMonths {
  months: LiveMarketMonth[];
  at: string | null;
}

/** This market's year if it is on file and still stands. */
export async function storedMarketMonths(
  marketSlug: string
): Promise<StoredMonths | null> {
  const row = await readKeyedBlob(historyKey(marketSlug)).catch(() => null);
  if (!row || !isFresh(row.at, HISTORY_TTL_MS)) return null;
  const months = readMonths(row.value);
  // An empty series is not a measurement — it is the shape the feed
  // answers with when it had nothing, and storing it must not make the
  // market look bought.
  return months.length > 0 ? { months, at: row.at } : null;
}

export type BuyMonthsResult =
  | { ok: true; months: LiveMarketMonth[]; at: string; bought: boolean }
  | { ok: false; reason: "no-key" | "not-found" | "failed" };

/**
 * Buy one market's year and keep it.
 *
 * Returns a failure rather than throwing, because the caller's next act
 * is to decide whether to charge for this, and nothing that failed
 * should ever be charged for.
 */
export async function buyMarketMonths(market: Market): Promise<BuyMonthsResult> {
  if (!hasAirRoiKey()) return { ok: false, reason: "no-key" };
  try {
    const months = readMonths(await fetchMarketMonths(catalogueRef(market)));
    if (months.length === 0) return { ok: false, reason: "not-found" };
    const at = new Date().toISOString();
    // Never let a storage failure cost the answer just paid for.
    await writeKeyed(historyKey(market.slug), { months }).catch(() => {});
    return { ok: true, months, at, bought: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
