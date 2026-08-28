/**
 * Fill the market store on purpose:
 *   /api/markets/backfill?limit=10&secret=…      → resolve 10 unstored markets
 *   /api/markets/backfill?secret=…&dry=1         → count what is left, spend nothing
 *   …&only=course                                → just the markets the course teaches
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
import { COURSE_MARKETS } from "@/lib/mock/course-markets";
import { fetchLiveMarket } from "@/lib/live/market-live";
import { hasAirRoiKey } from "@/lib/live/airroi";
import {
  isFresh,
  readAllMarketStats,
  storeConfigured,
  storeStatus,
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

  /**
   * Prove the store can round-trip BEFORE spending anything.
   *
   * The first real batch resolved five markets, reported success, and
   * stored nothing: the write was failing and the writer was not
   * looking at the response. Fifteen billed calls bought a number on a
   * screen. A configured store is not the same claim as a working one,
   * and only one of them is worth spending against.
   */
  const health = await storeStatus();
  if (!health.ok) {
    return NextResponse.json(
      {
        error: "the store cannot be written to — refusing to spend",
        detail: health.detail,
        spent: 0,
      },
      { status: 503 }
    );
  }

  /**
   * `only=course` restricts the queue to the markets the mentorship
   * teaches — 75 of 409.
   *
   * Not a shortcut so much as the right order. Those are the markets
   * students are told to look at, so they are the ones that will
   * actually be opened; the rest of the catalogue can fill itself in
   * over time as people wander into it, at no cost until they do.
   * 225 calls against 1,227 for the set that carries the traffic.
   */
  const courseOnly = searchParams.get("only") === "course";
  const queue = courseOnly
    ? MARKETS.filter((m) => COURSE_MARKETS.has(m.slug))
    : MARKETS;

  const stored = await readAllMarketStats();
  const pending = queue.filter((m) => {
    const row = stored.get(m.slug);
    return !row || !isFresh(row.at);
  });

  if (searchParams.get("dry")) {
    return NextResponse.json({
      scope: courseOnly ? "course markets" : "every market",
      inScope: queue.length,
      stored: stored.size,
      pending: pending.length,
      callsToFinish: pending.length * CALLS_PER_MARKET,
      note: courseOnly
        ? "Nothing was spent. This counts only the markets the course teaches."
        : "Nothing was spent. Add only=course to count just the markets the course teaches.",
    });
  }

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(searchParams.get("limit")) || 5)
  );

  const done: string[] = [];
  const failed: string[] = [];
  const unsaved: { slug: string; detail: string | null }[] = [];
  // Sequential on purpose: three calls per market in parallel across a
  // batch is how a rate limit gets discovered the expensive way.
  for (const market of pending.slice(0, limit)) {
    const live = await fetchLiveMarket(market);
    if (!live) {
      failed.push(market.slug);
      continue;
    }
    const write = await writeMarketStats(market.slug, {
      ...live.summary,
      fullName: live.fullName,
      ...(live.monthly.length > 0 ? { monthly: live.monthly } : {}),
    });
    // Resolved is not the same as kept. Counting a fetch as a success
    // is how a batch reports five markets stored with an empty table
    // behind it.
    if (write.ok) done.push(market.slug);
    else unsaved.push({ slug: market.slug, detail: write.detail });
  }

  // A store that rejects every write mid-run turns each further batch
  // into pure waste, so say it plainly rather than leaving a count to
  // be noticed.
  const storeBroken = unsaved.length > 0 && done.length === 0;

  return NextResponse.json(
    {
      scope: courseOnly ? "course markets" : "every market",
      /** Fetched AND kept. Anything else is money spent for nothing. */
      stored: done.length,
      fetchFailed: failed.length,
      writeFailed: unsaved.length,
      /** What this run actually cost, in requests. */
      callsMade: (done.length + failed.length + unsaved.length) * CALLS_PER_MARKET,
      remaining: pending.length - done.length,
      callsToFinish: (pending.length - done.length) * CALLS_PER_MARKET,
      slugs: done,
      failedSlugs: failed,
      unsaved,
      note: storeBroken
        ? "NOTHING WAS KEPT. Every write was rejected, so this batch spent its calls for nothing — fix the store before running another."
        : unsaved.length > 0
          ? "Some markets were fetched but not saved. Those calls bought nothing and the markets are still pending."
          : failed.length > 0
            ? "Failures cost their calls too — a market with no coverage answers, it just answers with nothing usable."
            : null,
    },
    { status: storeBroken ? 500 : 200 }
  );
}
