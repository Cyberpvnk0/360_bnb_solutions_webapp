/** Client-initiated market analysis. Prefetching stays read-only. Fresh sections
 * are free; missing sections run concurrently and cost one credit each only on
 * success (three for a new complete market). Keep existing ledger keys so
 * retries and older standalone purchases do not charge the same section twice. */
import { NextResponse } from "next/server";
import { MARKET_STATS_CREDITS, MARKET_HISTORY_CREDITS, MARKET_PACING_CREDITS } from "@/config/app";
import { requireMarketAnalyzer } from "@/lib/auth/gate";
import { canCover, spendCredits } from "@/lib/db/usage";
import { buyMarketStats, measureKey, storedMarketStats } from "@/lib/live/market-measure";
import { buyMarketMonths, historyKey, storedMarketMonths } from "@/lib/live/market-history";
import { buyMarketPacing, pacingKey, storedMarketPacing } from "@/lib/live/market-pacing";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

export const maxDuration = 60;

async function settle<T>(request: Promise<T>) {
  try { return await request; }
  catch { return { ok: false as const, reason: "failed" }; }
}

export async function POST(request: Request) {
  const paid = await requireMarketAnalyzer();
  if (!paid.ok) return paid.response;
  const body = await request.json().catch(() => null);
  const market = MARKET_BY_SLUG.get(typeof body?.market === "string" ? body.market : "");
  if (!market) return NextResponse.json({ ok: false, reason: "unknown-market" }, { status: 404 });

  const [stats, storedYear, pace] = await Promise.all([
    storedMarketStats(market.slug).catch(() => null),
    storedMarketMonths(market.slug).catch(() => null),
    storedMarketPacing(market.slug).catch(() => null),
  ]);
  // Backfilled history can also live on the fresh headline row.
  const year = storedYear ?? (stats?.stats.monthly?.length
    ? { months: stats.stats.monthly, at: stats.at } : null);
  const cost = (stats ? 0 : MARKET_STATS_CREDITS)
    + (year ? 0 : MARKET_HISTORY_CREDITS)
    + (pace ? 0 : MARKET_PACING_CREDITS);
  if (cost > 0) {
    const cover = await canCover(paid.user.id, paid.tier, cost);
    if (!cover.ok) return NextResponse.json(
      { ok: false, reason: "no-credits", remaining: cover.remaining, cost }, { status: 402 }
    );
  }

  const [summaryResult, yearResult, paceResult] = await Promise.all([
    stats ? { ok: true as const, ...stats, bought: false } : settle(buyMarketStats(market)),
    year ? { ok: true as const, ...year, bought: false } : settle(buyMarketMonths(market)),
    pace ? { ok: true as const, ...pace, bought: false } : settle(buyMarketPacing(market)),
  ]);

  const errors: { section: string; message: string }[] = [];
  let charged = 0;
  // Sequential ledger calls preserve the account balance under concurrent
  // purchases; the existing atomic spend refuses overdrafts and repeats.
  for (const section of [
    { name: "Headline figures", result: summaryResult, key: measureKey(market.slug), price: MARKET_STATS_CREDITS },
    { name: "Through the year", result: yearResult, key: historyKey(market.slug), price: MARKET_HISTORY_CREDITS },
    { name: "Booked ahead", result: paceResult, key: `${pacingKey(market.slug)}:${paceResult.ok ? paceResult.at?.slice(0, 7) : ""}`, price: MARKET_PACING_CREDITS },
  ]) {
    if (!section.result.ok) {
      errors.push({ section: section.name, message: `${section.name} could not be fetched. Reload to try again; this section was not charged.` });
    } else if (section.result.bought) {
      const spend = await spendCredits(paid.user.id, paid.tier, section.key, section.price);
      if (spend.allowed) charged += spend.charged;
    }
  }
  // Keep successful sections visible even when another provider request fails.
  const ok = summaryResult.ok || yearResult.ok || paceResult.ok;
  return NextResponse.json({
    ok, complete: errors.length === 0, charged, errors,
    stats: summaryResult.ok ? summaryResult.stats : null,
    at: summaryResult.ok ? summaryResult.at : null,
    months: yearResult.ok ? yearResult.months : [],
    monthsAt: yearResult.ok ? yearResult.at : null,
    pace: paceResult.ok ? paceResult.days : [],
    paceAt: paceResult.ok ? paceResult.at : null,
    ...(ok ? {} : { reason: "failed", message: "The market analysis could not be fetched. Nothing was charged." }),
  }, { status: ok ? 200 : 502, headers: { "Cache-Control": "no-store" } });
}
