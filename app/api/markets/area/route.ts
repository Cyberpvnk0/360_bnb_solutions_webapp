/**
 * One ZIP's real short-let figures:  POST /api/markets/area
 *
 *   { market: "<slug>", zip: "32207", lat, lon }
 *
 * The market page ranks its ZIPs off listings the product has already
 * seen, which is free and is a sample. This is the other thing: the
 * feed's own figures for the whole ZIP, including the active-listing
 * count a sample can never give. Stored under the ZIP and shared with
 * every account after, so the same neighbourhood is bought once.
 *
 * PRICED, BECAUSE IT SPENDS REAL MONEY. Two billed calls the first time
 * a ZIP is asked about, at config/app AREA_MEASURE_CREDITS. The room is
 * read before the feed is asked and the credits are taken only once an
 * answer is actually in hand, so:
 *
 *   already on file   free, whatever the account's balance is
 *   feed refused      free — nothing was bought, so nothing is charged
 *   bought            charged, once per ZIP per period
 *
 * Only accounts on a plan.
 */

import { NextResponse } from "next/server";
import { AREA_MEASURE_CREDITS } from "@/config/app";
import { requireMarketAnalyzer } from "@/lib/auth/gate";
import { canCover, spendCredits } from "@/lib/db/usage";
import { areaKey, buyArea, storedArea } from "@/lib/live/area-stats";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

export const maxDuration = 30;

const FAILED: Record<string, { status: number; message: string }> = {
  "no-key": { status: 503, message: "Live figures are not configured." },
  quota: { status: 429, message: "The day's area searches are used up." },
  "not-found": { status: 404, message: "No figures for that area yet." },
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
  const zip = typeof body?.zip === "string" ? body.zip : "";
  const lat = Number(body?.lat);
  const lon = Number(body?.lon);
  if (
    !/^\d{5}$/.test(zip) ||
    !Number.isFinite(lat) ||
    Math.abs(lat) > 90 ||
    !Number.isFinite(lon) ||
    Math.abs(lon) > 180
  ) {
    return NextResponse.json({ ok: false, reason: "bad-area" }, { status: 400 });
  }

  // Somebody already paid for this one. Free, and free before the
  // balance is even looked at.
  const onFile = await storedArea(market.slug, zip).catch(() => null);
  if (onFile) {
    return NextResponse.json(
      { ok: true, zip, stats: onFile, bought: false, charged: 0 },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const cover = await canCover(paid.user.id, paid.tier, AREA_MEASURE_CREDITS);
  if (!cover.ok) {
    return NextResponse.json(
      {
        ok: false,
        reason: "no-credits",
        remaining: cover.remaining,
        cost: AREA_MEASURE_CREDITS,
      },
      { status: 402 }
    );
  }

  const result = await buyArea(market.slug, zip, { lat, lon });
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
    areaKey(market.slug, zip),
    AREA_MEASURE_CREDITS
  );
  return NextResponse.json(
    {
      ok: true,
      zip: result.zip,
      stats: result.stats,
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
