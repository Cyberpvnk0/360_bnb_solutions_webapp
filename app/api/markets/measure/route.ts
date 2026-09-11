/**
 * One market's headline figures:  POST /api/markets/measure
 *
 *   { market: "<slug>" }
 *
 * Nothing pre-fetches a market, so most of the catalogue shows a rule
 * and a lease estimate and dashes where the performance should be. This
 * is the button that fills one in. Stored and shared with every account
 * after, so a market is bought once for everybody.
 *
 * PRICED, BECAUSE IT SPENDS REAL MONEY. One billed call at config/app
 * MARKET_MEASURE_CREDITS. The room is read before the feed is asked and
 * the credits are taken only once an answer is in hand, so a market
 * already on file is free whatever the balance is, and a call that came
 * back with nothing is charged nothing.
 *
 * Only accounts on a plan.
 */

import { NextResponse } from "next/server";
import { MARKET_MEASURE_CREDITS } from "@/config/app";
import { requireMarketAnalyzer } from "@/lib/auth/gate";
import { canCover, spendCredits } from "@/lib/db/usage";
import {
  buyMarketStats,
  measureKey,
  storedMarketStats,
} from "@/lib/live/market-measure";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

export const maxDuration = 30;

const FAILED: Record<string, { status: number; message: string }> = {
  "no-key": { status: 503, message: "Live figures are not configured." },
  quota: { status: 429, message: "The day's area searches are used up." },
  "not-found": { status: 404, message: "No figures for that market yet." },
  failed: { status: 502, message: "The figures could not be fetched." },
};

export async function POST(request: Request) {
  const paid = await requireMarketAnalyzer();
  if (!paid.ok) return paid.response;

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const market = MARKET_BY_SLUG.get(
    typeof body?.market === "string" ? body.market : ""
  );
  if (!market) {
    return NextResponse.json({ ok: false, reason: "unknown-market" }, { status: 404 });
  }

  // Somebody already paid for this one. Free, and free before the
  // balance is even looked at.
  const onFile = await storedMarketStats(market.slug).catch(() => null);
  if (onFile) {
    return NextResponse.json(
      { ok: true, stats: onFile.stats, at: onFile.at, bought: false, charged: 0 },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const cover = await canCover(paid.user.id, paid.tier, MARKET_MEASURE_CREDITS);
  if (!cover.ok) {
    return NextResponse.json(
      {
        ok: false,
        reason: "no-credits",
        remaining: cover.remaining,
        cost: MARKET_MEASURE_CREDITS,
      },
      { status: 402 }
    );
  }

  const result = await buyMarketStats(market);
  if (!result.ok) {
    const how = FAILED[result.reason] ?? FAILED.failed;
    return NextResponse.json(
      { ok: false, reason: result.reason, message: how.message, charged: 0 },
      { status: how.status }
    );
  }

  const spend = await spendCredits(
    paid.user.id,
    paid.tier,
    measureKey(market.slug),
    MARKET_MEASURE_CREDITS
  );
  return NextResponse.json(
    {
      ok: true,
      stats: result.stats,
      at: result.at,
      bought: result.bought,
      // A refusal here is a race with a spend that landed between
      // reading the room and asking the feed. The feed has been paid;
      // the answer goes out, unbilled, rather than being thrown away.
      charged: spend.allowed ? spend.charged : 0,
      used: spend.used,
      cap: spend.cap,
      balance: spend.balance ?? null,
      ...(spend.unmetered ? { unmetered: spend.unmetered } : {}),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
