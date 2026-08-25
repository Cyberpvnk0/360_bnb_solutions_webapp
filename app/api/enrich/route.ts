/**
 * Feature enrichment for live listings.
 *
 *   POST /api/enrich          { targets: [{id, address, city, stateCode}] }
 *   GET  /api/enrich?probe=jacksonville&n=25
 *
 * POST is what the app calls: hand it a visible page of live rows whose
 * amenities are unknown, get back feature FLAGS to merge onto them. No
 * listing prose crosses this boundary in either direction — see the rule
 * at the top of lib/live/scraperapi.
 *
 * GET is the measurement run. It answers the three questions that decide
 * whether this vendor is worth paying for, in one deliberate spend:
 * does it get through at all, what does a property actually cost in
 * credits, and what share of addresses resolve to readable text.
 *
 * Both are bounded by a daily ceiling on PROPERTIES READ (lib/live/quota),
 * because with this vendor every address is its own billed call.
 */

import { NextResponse } from "next/server";
import { enrichTargets, MAX_ENRICH_PER_REQUEST, targetsFor } from "@/lib/live/enrich";
import { reserveEnrichments } from "@/lib/live/quota";
import { fetchLiveRentals, RentCastError } from "@/lib/live/rentcast";
import { ScraperApiError } from "@/lib/live/scraperapi";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

/**
 * Reading a protected listing page takes seconds, not milliseconds, and
 * a batch is a whole concurrency wave of them — well past the default
 * serverless slice, which would kill the request mid-wave and look to a
 * student like the lookup silently failing. 60s clears a wave with room
 * to spare and is inside every Vercel plan's ceiling; raise it only if
 * you also raise the batch size.
 */
export const maxDuration = 60;

interface TargetInput {
  id?: unknown;
  address?: unknown;
  city?: unknown;
  stateCode?: unknown;
}

function readTargets(body: unknown) {
  const raw = (body as { targets?: unknown })?.targets;
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const item of raw as TargetInput[]) {
    if (
      typeof item?.id === "string" &&
      typeof item.address === "string" &&
      typeof item.city === "string" &&
      typeof item.stateCode === "string"
    ) {
      out.push({
        id: item.id,
        address: item.address,
        city: item.city,
        stateCode: item.stateCode,
      });
    }
  }
  return out;
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const targets = readTargets(body);
  if (!targets) {
    return NextResponse.json(
      { ok: false, reason: "bad-request" },
      { status: 400 }
    );
  }
  if (targets.length === 0) {
    return NextResponse.json({ ok: true, facts: {}, attempted: 0, resolved: 0 });
  }

  const budget = reserveEnrichments(
    Math.min(targets.length, MAX_ENRICH_PER_REQUEST)
  );
  if (budget.granted === 0) {
    return NextResponse.json(
      { ok: false, reason: "daily-cap", cap: budget.cap, remaining: 0 },
      { status: 429 }
    );
  }

  try {
    const batch = await enrichTargets(targets.slice(0, budget.granted));
    return NextResponse.json({
      ok: true,
      facts: batch.facts,
      attempted: batch.attempted,
      resolved: batch.resolved,
      remaining: budget.remaining,
      cap: budget.cap,
    });
  } catch (error) {
    const reason =
      error instanceof ScraperApiError ? error.reason : "network";
    return NextResponse.json({ ok: false, reason }, { status: 502 });
  }
}

/**
 * Measurement run over real addresses from the live RentCast feed.
 *
 * Reports per-address outcomes and the three aggregates that matter,
 * and never a word of any listing: which extraction strategy won, how
 * many credits went out, and the resolve rate.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("probe");
  const market = MARKET_BY_SLUG.get(slug ?? "");
  if (!market) {
    return NextResponse.json(
      { ok: false, reason: "unknown-market", hint: "?probe=jacksonville&n=25" },
      { status: 404 }
    );
  }

  const requested = Number(searchParams.get("n"));
  const n = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), MAX_ENRICH_PER_REQUEST)
    : 10;

  let listings;
  try {
    listings = await fetchLiveRentals(market);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "rentcast",
        reason: error instanceof RentCastError ? error.reason : "network",
      },
      { status: 502 }
    );
  }

  const targets = targetsFor(listings).slice(0, n);
  if (targets.length === 0) {
    return NextResponse.json({
      ok: false,
      stage: "rentcast",
      reason: "no-live-rows",
      note:
        "The live feed returned nothing to enrich — check /api/rentals?market=" +
        `${market.slug}&shape=1 first.`,
    });
  }

  const budget = reserveEnrichments(targets.length);
  if (budget.granted === 0) {
    return NextResponse.json(
      { ok: false, reason: "daily-cap", cap: budget.cap, remaining: 0 },
      { status: 429 }
    );
  }

  const batch = await enrichTargets(targets.slice(0, budget.granted));
  const strategies: Record<string, number> = {};
  const failures: Record<string, number> = {};
  for (const r of batch.records) {
    if (r.strategy) strategies[r.strategy] = (strategies[r.strategy] ?? 0) + 1;
    if (r.failure) failures[r.failure] = (failures[r.failure] ?? 0) + 1;
  }
  const blocked = batch.records.filter((r) => r.blocked).length;
  const tiers: Record<string, number> = {};
  for (const r of batch.records) tiers[r.tier] = (tiers[r.tier] ?? 0) + 1;
  // Where the pipeline actually got to, and what it was looking at —
  // the difference between "extraction is wrong" and "we never reached
  // the page that has the description".
  const reachedDetail = batch.records.filter((r) => r.reachedDetail).length;
  const withSignals = batch.records.filter((r) => r.signals);
  const tally = (pick: (s: NonNullable<typeof withSignals[number]["signals"]>) => boolean) =>
    withSignals.filter((r) => pick(r.signals!)).length;
  const furnished = batch.records.filter((r) =>
    r.features.includes("Furnished")
  ).length;

  return NextResponse.json({
    ok: true,
    market: market.slug,
    /** Did it get through at all, and how often. */
    attempted: batch.attempted,
    resolved: batch.resolved,
    resolveRate: `${Math.round((batch.resolved / batch.attempted) * 100)}%`,
    /** How long it took — the answer to "how long will a page take".
     *  msPerProperty is the honest per-read cost; a batch runs them
     *  concurrency-many at a time, so a full 24-card page is roughly
     *  msBatch × ceil(24 / batch size). */
    msBatch: batch.ms,
    msPerProperty: Math.round(
      batch.records.reduce((sum, r) => sum + r.ms, 0) /
        Math.max(1, batch.records.length)
    ),
    msSlowest: batch.records.reduce((max, r) => Math.max(max, r.ms), 0),
    /** What it cost. Null means ScraperAPI reported no credit header —
     *  read the real number off their dashboard instead. */
    creditsSpent: batch.creditsSpent,
    creditsPerProperty:
      batch.creditsSpent !== null
        ? Math.round((batch.creditsSpent / batch.attempted) * 10) / 10
        : null,
    /** How many were refused by the site at every tier we tried, and
     *  which tier finally answered for the rest. */
    blockedCount: blocked,
    tiers,
    /** Where the text was found, and what went wrong where it wasn't. */
    strategies,
    failures,
    /** What the vendor SAID about each distinct refusal. A 403 that
     *  reads "not available on your plan" is a billing decision; one
     *  that reads anything else is a different problem entirely. */
    vendorMessages: [
      ...new Set(
        batch.records
          .map((r) => r.failureDetail)
          .filter((d): d is string => Boolean(d))
      ),
    ].slice(0, 5),
    /** How far the two-hop got, and what the last page looked like.
     *  Booleans and counts only — never a word of any listing. */
    reachedDetail,
    pageSignals: {
      hasDetailLink: tally((x) => x.hasDetailLink),
      hasNextData: tally((x) => x.hasNextData),
      hasApollo: tally((x) => x.hasApollo),
      hasJsonLd: tally((x) => x.hasJsonLd),
      looksLikeChallenge: tally((x) => x.looksLikeChallenge),
      boilerplateOnly: tally((x) => x.boilerplate),
      medianBytes: (() => {
        const sizes = withSignals
          .map((r) => r.signals!.bytes)
          .sort((a, b) => a - b);
        return sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
      })(),
    },
    /** Of the pages we could read, how many say furnished. */
    furnishedFound: furnished,
    records: batch.records,
    remaining: budget.remaining,
    cap: budget.cap,
  });
}
