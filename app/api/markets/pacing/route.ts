/**
 * One market's forward book:  POST /api/markets/pacing
 *
 *   { market: "<slug>" }
 *
 * What is already reserved in this market ahead of today — the one
 * figure in the product that is not trailing. One billed call at
 * config/app MARKET_PACING_CREDITS, on the same terms as every other
 * measurement here:
 *
 *   already on file   free, whatever the account's balance is
 *   feed refused      free — nothing was bought, so nothing is charged
 *   bought            charged, once per market per period
 *
 * Only accounts on a plan.
 */

import { NextResponse } from "next/server";
import { MARKET_PACING_CREDITS } from "@/config/app";
import { requireMarketAnalyzer } from "@/lib/auth/gate";
import { canCover, spendCredits } from "@/lib/db/usage";
import {
  buyMarketPacing,
  pacingKey,
  storedMarketPacing,
} from "@/lib/live/market-pacing";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

export const maxDuration = 30;

const FAILED: Record<string, { status: number; message: string }> = {
  "no-key": { status: 503, message: "Live figures are not configured." },
  "not-found": { status: 404, message: "Nothing booked ahead in that market yet." },
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

  const onFile = await storedMarketPacing(market.slug).catch(() => null);
  if (onFile) {
    return NextResponse.json(
      { ok: true, days: onFile.days, at: onFile.at, bought: false, charged: 0 },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const cover = await canCover(paid.user.id, paid.tier, MARKET_PACING_CREDITS);
  if (!cover.ok) {
    return NextResponse.json(
      {
        ok: false,
        reason: "no-credits",
        remaining: cover.remaining,
        cost: MARKET_PACING_CREDITS,
      },
      { status: 402 }
    );
  }

  const result = await buyMarketPacing(market);
  if (!result.ok) {
    const how = FAILED[result.reason] ?? FAILED.failed;
    return NextResponse.json(
      { ok: false, reason: result.reason, message: how.message, charged: 0 },
      { status: how.status }
    );
  }

  // Keyed by the week it was bought in, not by the market alone: a
  // forward book goes stale in days, so the same reader coming back
  // next month is buying a genuinely different answer and should pay
  // for it — while a second look this week is free.
  const spend = await spendCredits(
    paid.user.id,
    paid.tier,
    `${pacingKey(market.slug)}:${result.at.slice(0, 7)}`,
    MARKET_PACING_CREDITS
  );
  return NextResponse.json(
    {
      ok: true,
      days: result.days,
      at: result.at,
      bought: result.bought,
      charged: spend.allowed ? spend.charged : 0,
      used: spend.used,
      cap: spend.cap,
      balance: spend.balance ?? null,
      ...(spend.unmetered ? { unmetered: spend.unmetered } : {}),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
