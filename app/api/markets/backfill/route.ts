/**
 * Fill the market store on purpose:
 *   /api/markets/backfill?limit=10&secret=…      → resolve 10 unstored markets
 *   /api/markets/backfill?secret=…&dry=1         → count what is left, spend nothing
 *
 * The grid reads the store and never calls the vendor, so measured
 * figures only appear for markets someone has already opened. This is
 * the lever for filling the rest without waiting for a visitor.
 *
 * DELIBERATE, BOUNDED, AND OUT LOUD. Three billed calls per market
 * across 409 markets is over twelve hundred requests at a price the
 * vendor does not publish in its spec, so nothing here runs on a
 * schedule and nothing runs unbounded: a limit is required, capped, and
 * every response says exactly how many markets were resolved and how
 * many calls that was. Run it in batches, watch the bill, decide.
 */

import { NextResponse } from "next/server";
import { MARKETS } from "@/lib/mock/markets";
import { fetchLiveMarket } from "@/lib/live/market-live";
import { hasAirRoiKey } from "@/lib/live/airroi";
import {
  isFresh,
  readAllMarketStats,
  storeConfigured,
  writeMarketStats,
} from "@/lib/db/market-store";

export const maxDuration = 300;

/** Calls made per market: identity, summary, history. */
const CALLS_PER_MARKET = 3;
/** A ceiling that keeps one invocation inside the function timeout and
 *  one mistake inside a bill somebody can look at without flinching. */
const MAX_LIMIT = 25;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // Same secret the platform sends its cron requests with. Without one
  // set this endpoint stays shut rather than defaulting to open: an
  // unauthenticated URL that spends money is not a diagnostic.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "set CRON_SECRET before this endpoint will spend anything" },
      { status: 503 }
    );
  }
  const offered =
    searchParams.get("secret") ??
    request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (offered !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!storeConfigured()) {
    return NextResponse.json(
      { error: "no store configured — every market would be re-bought on the next deploy" },
      { status: 503 }
    );
  }
  if (!hasAirRoiKey()) {
    return NextResponse.json({ error: "no AIRROI_API_KEY" }, { status: 503 });
  }

  const stored = await readAllMarketStats();
  const pending = MARKETS.filter((m) => {
    const row = stored.get(m.slug);
    return !row || !isFresh(row.at);
  });

  if (searchParams.get("dry")) {
    return NextResponse.json({
      stored: stored.size,
      pending: pending.length,
      callsToFinish: pending.length * CALLS_PER_MARKET,
      note: "Nothing was spent. Re-run without dry=1 and with a limit to resolve a batch.",
    });
  }

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(searchParams.get("limit")) || 5)
  );

  const done: string[] = [];
  const failed: string[] = [];
  // Sequential on purpose: three calls per market in parallel across a
  // batch is how a rate limit gets discovered the expensive way.
  for (const market of pending.slice(0, limit)) {
    const live = await fetchLiveMarket(market);
    if (!live) {
      failed.push(market.slug);
      continue;
    }
    await writeMarketStats(market.slug, {
      ...live.summary,
      fullName: live.fullName,
      ...(live.monthly.length > 0 ? { monthly: live.monthly } : {}),
    });
    done.push(market.slug);
  }

  return NextResponse.json({
    resolved: done.length,
    failed: failed.length,
    /** What this run actually cost, in requests. */
    callsMade: (done.length + failed.length) * CALLS_PER_MARKET,
    remaining: pending.length - done.length,
    callsToFinish: (pending.length - done.length) * CALLS_PER_MARKET,
    slugs: done,
    failedSlugs: failed,
    note:
      failed.length > 0
        ? "Failures cost their calls too — a market with no coverage answers, it just answers with nothing usable."
        : null,
  });
}
