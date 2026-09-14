/**
 * One market's twelve months:  POST /api/markets/history
 *
 *   { market: "<slug>" }
 *
 * The market page draws a seasonal chart when it has a year and says
 * nothing when it does not, because the year is a billed call the page
 * itself must never make — opening a market is not a purchase. This is
 * the request that buys one, made by a reader who wants it.
 *
 * PRICED, BECAUSE IT SPENDS REAL MONEY. One billed call at config/app
 * MARKET_HISTORY_CREDITS. The room is read before the feed is asked and
 * the credits are taken only once an answer is in hand, so:
 *
 *   already on file   free, whatever the account's balance is
 *   feed refused      free — nothing was bought, so nothing is charged
 *   bought            charged, once per market per period
 *
 * Only accounts on a plan.
 */

import { NextResponse } from "next/server";
import { MARKET_HISTORY_CREDITS } from "@/config/app";
import { requireMarketAnalyzer } from "@/lib/auth/gate";
import { canCover, spendCredits } from "@/lib/db/usage";
import {
  buyMarketMonths,
  historyKey,
  storedMarketMonths,
} from "@/lib/live/market-history";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

export const maxDuration = 30;

const FAILED: Record<string, { status: number; message: string }> = {
  "no-key": { status: 503, message: "Live figures are not configured." },
  "not-found": { status: 404, message: "No monthly figures for that market yet." },
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
  const onFile = await storedMarketMonths(market.slug).catch(() => null);
  if (onFile) {
    return NextResponse.json(
      { ok: true, months: onFile.months, at: onFile.at, bought: false, charged: 0 },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const cover = await canCover(paid.user.id, paid.tier, MARKET_HISTORY_CREDITS);
  if (!cover.ok) {
    return NextResponse.json(
      {
        ok: false,
        reason: "no-credits",
        remaining: cover.remaining,
        cost: MARKET_HISTORY_CREDITS,
      },
      { status: 402 }
    );
  }

  const result = await buyMarketMonths(market);
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
    historyKey(market.slug),
    MARKET_HISTORY_CREDITS
  );
  return NextResponse.json(
    {
      ok: true,
      months: result.months,
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
