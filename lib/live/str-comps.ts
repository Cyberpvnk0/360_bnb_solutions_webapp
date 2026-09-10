/**
 * Server-side swap of an analysis's comp set for live AirROI comps.
 *
 * The whole projection derives from `strComps` — ADR, occupancy, the
 * revenue range, the breakeven gauge — so replacing that one array makes
 * every downstream number real without touching a component.
 *
 * Falls back silently to the seeded comps whenever the feed is missing,
 * capped, unreachable, or too thin to underwrite on. The caller shows
 * which set it got; the numbers are never a blend of the two.
 *
 * READ THE STORE FIRST. This is the most expensive recurring call in
 * the product — one per analysis, at a per-call price in tens of cents
 * rather than the hundredth of a dollar the vendor's published floor
 * implies. It was held only in the framework's cache, which dies with
 * each deployment, so a push discarded every comp set anyone had
 * bought. With thousands of students the same handful of addresses
 * gets re-bought over and over, and nothing in the system would have
 * said so.
 */

import { fetchEstimate, hasAirRoiKey } from "@/lib/live/airroi";
import {
  estimateKey,
  isFresh,
  readEstimate,
  writeEstimate,
} from "@/lib/db/market-store";
import { checkLiveSearch, commitLiveSearch } from "@/lib/live/quota";
import type { Analysis, StrComp } from "@/lib/mock/types";

/** Below this a comp set can't carry a projection honestly. */
export const MIN_COMPS = 4;

export interface CompsResolution {
  analysis: Analysis;
  /** True when the comps on screen came from AirROI. */
  liveComps: boolean;
}

/** A month of freshness. A property's trailing-twelve comps do not
 *  move week to week, and every day of TTL is an address nobody pays
 *  for twice. */
export const ESTIMATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The format a stored comp set was written in.
 *
 *   1 (unmarked)  ids parsed as numbers, so any past 2^53 were rounded
 *                 and their links opened nothing.
 *   2             ids kept exact through the parse (parseJsonKeepingBigIds).
 *   3             listings the feed marks as no longer up are left out
 *                 of the set (lib/live/airroi, activityOf).
 *   4             "no longer up" read off the last-90-day calendar the
 *                 feed actually carries, and private or shared rooms
 *                 left out (wholePlace).
 *
 * A set written in an older format is bought again, once: it may hold
 * comps that are not comps any more, and nothing in it says which. A
 * set written in the current format is kept as it is, whatever its
 * links look like — if its ids look rounded then the vendor sent them
 * so, and buying again would only buy the same; those links are
 * dropped at render instead (lib/live/comp-links).
 */
export const ESTIMATE_VERSION = 4;

/** The vendor spec for an analysis at a point — the thing a comp set
 *  is bought for. One builder, so the plan meter and the cache agree
 *  on what "one analysis" is. */
export function compsSpecFor(
  analysis: Pick<Analysis, "bedrooms" | "bathrooms">,
  point: { lat: number; lon: number }
) {
  return {
    lat: point.lat,
    lon: point.lon,
    bedrooms: analysis.bedrooms,
    baths: analysis.bathrooms,
    // Inferred the way the industry does, two to a bedroom, because the
    // analysis records the property rather than its listing.
    guests: Math.max(2, analysis.bedrooms * 2),
  };
}

/**
 * What the plan counts as one analysis: this property at this size.
 *
 * Deliberately the comps cache key. A reload of the same page is the
 * same key and never a second one; a re-run at a different size is a
 * different comp set the vendor bills for, and a different key.
 */
export function analysisUsageKey(
  analysis: Pick<Analysis, "bedrooms" | "bathrooms">,
  point: { lat: number; lon: number }
): string {
  return estimateKey(compsSpecFor(analysis, point));
}

export async function withLiveComps(
  analysis: Analysis,
  point: { lat: number; lon: number } | null
): Promise<CompsResolution> {
  if (!point || !hasAirRoiKey()) return { analysis, liveComps: false };

  const spec = compsSpecFor(analysis, point);

  // The store before the wallet. A hit costs one database read and no
  // billed call at all, and it survives deploys — which the framework
  // cache underneath this does not.
  const cached = await readEstimate(estimateKey(spec)).catch(() => null);
  if (
    cached &&
    isFresh(cached.at, ESTIMATE_TTL_MS) &&
    cached.estimate.v === ESTIMATE_VERSION
  ) {
    // Belt and braces: the current format never stores one, but a
    // comp the feed marked as gone is not shown even if one got in.
    const comps = (cached.estimate.comps as StrComp[]).filter((c) => c.active !== false);
    if (comps.length >= MIN_COMPS) {
      return {
        analysis: {
          ...analysis,
          strComps: comps,
          ...(cached.estimate.monthlyRevenue
            ? { monthlyRevenueWeights: cached.estimate.monthlyRevenue }
            : {}),
        },
        liveComps: true,
      };
    }
    // A thin set, remembered as thin: the modelled comps stand in, and
    // the same answer is not bought again on every visit.
    return { analysis, liveComps: false };
  }

  const key = `str:${point.lat.toFixed(2)},${point.lon.toFixed(2)}`;
  if (!checkLiveSearch(key).allowed) return { analysis, liveComps: false };

  try {
    // Their calculator endpoint rather than plain comparables: same one
    // billed call, and it returns the comp set AND this address's own
    // twelve-month revenue distribution. Fetching comps alone and then
    // wanting the season would have cost a second call for data that
    // was already in the first response.
    //
    // Bedrooms alone leaves the feed guessing, so baths and guests go
    // too — both are required by the endpoint in any case. Guests is
    // inferred the way the industry does, two to a bedroom, because the
    // analysis records the property rather than its listing.
    const estimate = await fetchEstimate(spec);
    commitLiveSearch(key);

    // Just paid for this; make it the last time — a thin set included,
    // because a thin answer bought again is the same thin answer. A
    // write failure is survivable — the answer still renders — but it
    // means the next visitor buys the same address again, so it is not
    // ignored silently the way a pure cache write would be.
    await writeEstimate(estimateKey(spec), {
      v: ESTIMATE_VERSION,
      comps: estimate.comps,
      monthlyRevenue: estimate.monthlyRevenue,
      revenue: estimate.revenue,
      adr: estimate.adr,
      occupancy: estimate.occupancy,
    }).catch(() => ({ ok: false, detail: "write threw" }));
    if (estimate.comps.length < MIN_COMPS) return { analysis, liveComps: false };
    return {
      analysis: {
        ...analysis,
        strComps: estimate.comps,
        ...(estimate.monthlyRevenue
          ? { monthlyRevenueWeights: estimate.monthlyRevenue }
          : {}),
      },
      liveComps: true,
    };
  } catch {
    // Budget spent, feed down, key rejected — all the same answer here:
    // show the modelled comps and label them. The page must never fail
    // because a vendor did.
    return { analysis, liveComps: false };
  }
}
