/**
 * Fill the market store on purpose:
 *   /api/markets/backfill?secret=…&dry=1              → count what is left, spend nothing
 *   /api/markets/backfill?secret=…&probe=augusta-ga   → price both routes on one market
 *   /api/markets/backfill?secret=…&limit=25&only=course&identity=catalogue&history=0
 *
 * Nothing pre-fetches, so measured figures only appear for markets
 * someone has already opened. This is the lever for filling the rest.
 *
 * DELIBERATE, BOUNDED, AND OUT LOUD. Nothing here runs on a schedule
 * and nothing runs unbounded: a limit is required and capped, the run
 * stops when the day's call budget is spent rather than failing its way
 * through the rest of the queue, and every response reports the calls
 * the meter actually recorded rather than the number the plan assumed.
 *
 * WHAT A MARKET COSTS. At the measured $0.18 a call:
 *
 *   identity + summary + history   3 calls   $0.54   the page-load default
 *   identity + summary             2 calls   $0.36   history=0
 *   summary                        1 call    $0.18   history=0&identity=catalogue
 *
 * Across the 75 course markets that is $40.50, $27.00 or $13.50. The
 * cheap row is not free of consequences — addressing a market by name
 * measures the whole city where a coordinate lookup measures one ZIP —
 * which is what `probe` exists to show before a run commits to it.
 */

import { NextResponse } from "next/server";
import { MARKETS } from "@/lib/mock/markets";
import { COURSE_MARKETS } from "@/lib/mock/course-markets";
import { catalogueRef, fetchLiveMarket } from "@/lib/live/market-live";
import {
  airRoiBudget,
  fetchMarketIdentity,
  fetchMarketSummary,
  hasAirRoiKey,
} from "@/lib/live/airroi";
import {
  isFresh,
  readAllMarketStats,
  STATS_TTL_MS,
  storeConfigured,
  storeStatus,
  writeMarketStats,
} from "@/lib/db/market-store";
import { batchSize, callsPerMarket, money } from "@/lib/live/backfill-plan";

export const maxDuration = 300;

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
   */
  const courseOnly = searchParams.get("only") === "course";
  const queue = courseOnly
    ? MARKETS.filter((m) => COURSE_MARKETS.has(m.slug))
    : MARKETS;

  // history=0 drops the twelve-month series; identity=catalogue
  // addresses the market by name instead of buying a coordinate lookup.
  const history = searchParams.get("history") !== "0";
  const identity =
    searchParams.get("identity") === "catalogue" ? "catalogue" : "lookup";
  const perMarket = callsPerMarket({ identity, history });

  /* ---------------------------------------------------------------- */
  /* probe — price both routes against one market, then decide         */
  /* ---------------------------------------------------------------- */

  /**
   * Whether a market can be addressed by name is a question about their
   * service, not about this code, and it is not one to answer by
   * assumption: the last three guesses at this API's shape were all
   * wrong and each cost a debugging session. Four calls buys the
   * measurement — both summaries, side by side, on the same market.
   */
  const probeSlug = searchParams.get("probe");
  if (probeSlug) {
    const market = MARKETS.find((m) => m.slug === probeSlug);
    if (!market) {
      return NextResponse.json(
        { error: `no market with slug "${probeSlug}"` },
        { status: 404 }
      );
    }

    // Four calls, and every one of them must land: a probe that runs
    // out of budget halfway reports "catalogue did not work" when what
    // actually happened is that nothing was asked. That is the exact
    // wrong conclusion to hand somebody about to spend $27.
    const PROBE_CALLS = 4;
    if (airRoiBudget().left < PROBE_CALLS) {
      return NextResponse.json(
        {
          error: "not enough call budget left today to probe honestly",
          needs: PROBE_CALLS,
          budget: airRoiBudget(),
          hint: "Raise AIRROI_DAILY_CALLS and redeploy. A half-run probe would report a false negative.",
        },
        { status: 429 }
      );
    }

    const before = airRoiBudget().used;
    const byLookup = await fetchMarketIdentity({
      lat: market.lat,
      lon: market.lon,
    }).catch(() => null);
    const lookupSummary = byLookup?.market
      ? await fetchMarketSummary(byLookup.market).catch(() => null)
      : null;

    const ref = catalogueRef(market);
    const catalogueSummary = await fetchMarketSummary(ref).catch(() => null);

    const usable = (s: { adr: number | null; occupancy: number | null } | null) =>
      Boolean(s && s.adr !== null && s.adr > 0 && s.occupancy !== null);
    const works = usable(catalogueSummary?.summary ?? null);
    const calls = airRoiBudget().used - before;

    return NextResponse.json({
      market: market.slug,
      spent: { calls, cost: money(calls) },
      byLookup: {
        ref: byLookup?.market ?? null,
        fullName: byLookup?.fullName ?? null,
        summary: lookupSummary?.summary ?? null,
      },
      byCatalogue: {
        ref,
        fullName: catalogueSummary?.fullName ?? null,
        summary: catalogueSummary?.summary ?? null,
      },
      /**
       * The finding, stated rather than left to be inferred from two
       * blobs of JSON. The two figures will not match and are not meant
       * to: one is a ZIP, the other a city.
       */
      verdict: works
        ? "identity=catalogue works. It skips a billed call per market, at $0.18 each, " +
          "and measures the whole city rather than the ZIP the market's centre falls in. " +
          "Compare the two summaries above and decide which area you want on the cards."
        : "identity=catalogue did NOT return usable figures for this market. " +
          "Keep the default identity=lookup; history=0 still halves the cost from three calls to two.",
      catalogueUsable: works,
    });
  }

  const stored = await readAllMarketStats();
  const pending = queue.filter((m) => {
    const row = stored.get(m.slug);
    // Same TTL the request path reads with, or a backfill re-buys
    // markets the app would have served from the store anyway.
    return !row || !isFresh(row.at, STATS_TTL_MS);
  });

  if (searchParams.get("dry")) {
    const calls = pending.length * perMarket;
    return NextResponse.json({
      scope: courseOnly ? "course markets" : "every market",
      plan: { identity, history, callsPerMarket: perMarket },
      inScope: queue.length,
      stored: stored.size,
      pending: pending.length,
      callsToFinish: calls,
      costToFinish: money(calls),
      budgetLeftToday: airRoiBudget().left,
      cheapest: {
        callsToFinish: pending.length,
        costToFinish: money(pending.length),
        how: "&identity=catalogue&history=0 — run &probe=<slug> first to see what that measures.",
      },
      note: courseOnly
        ? "Nothing was spent. This counts only the markets the course teaches."
        : "Nothing was spent. Add only=course to count just the markets the course teaches.",
    });
  }

  const asked = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(searchParams.get("limit")) || 5)
  );

  const limit = batchSize({
    asked,
    pending: pending.length,
    budgetLeft: airRoiBudget().left,
    perMarket,
  });
  if (limit < 1 && pending.length > 0) {
    return NextResponse.json(
      {
        error: "today's call budget is spent on this instance",
        budget: airRoiBudget(),
        callsPerMarket: perMarket,
        hint: "Raise AIRROI_DAILY_CALLS and redeploy, or come back tomorrow. It is per-instance and per-day.",
      },
      { status: 429 }
    );
  }

  const spentBefore = airRoiBudget().used;
  const done: string[] = [];
  const failed: string[] = [];
  const unsaved: { slug: string; detail: string | null }[] = [];

  // Sequential on purpose: several calls per market in parallel across
  // a batch is how a rate limit gets discovered the expensive way.
  for (const market of pending.slice(0, limit)) {
    const live = await fetchLiveMarket(market, {
      identity,
      history,
      // A backfill is bounded by the secret, the batch limit and the
      // call budget. Letting it eat the students' daily search ledger
      // as well means one admin run locks them out until midnight.
      ignoreSearchQuota: true,
    });
    if (!live) {
      failed.push(market.slug);
      continue;
    }
    const write = await writeMarketStats(market.slug, {
      ...live.summary,
      fullName: live.fullName,
      scope: live.ref.district ? "zip" : "city",
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
  // From the meter, not from the plan: a market that failed at its
  // first call cost one, not three.
  const callsMade = airRoiBudget().used - spentBefore;
  const left = pending.length - done.length;

  return NextResponse.json(
    {
      scope: courseOnly ? "course markets" : "every market",
      plan: { identity, history, callsPerMarket: perMarket },
      /** Fetched AND kept. Anything else is money spent for nothing. */
      stored: done.length,
      fetchFailed: failed.length,
      writeFailed: unsaved.length,
      /** What this run actually cost, from the call meter. */
      callsMade,
      cost: money(callsMade),
      remaining: left,
      callsToFinish: left * perMarket,
      costToFinish: money(left * perMarket),
      budgetLeftToday: airRoiBudget().left,
      throttled:
        limit < asked
          ? `Asked for ${asked}, ran ${limit} — the rest would not fit in today's remaining call budget.`
          : null,
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
