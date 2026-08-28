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
const MIN_COMPS = 4;

export interface CompsResolution {
  analysis: Analysis;
  /** True when the comps on screen came from AirROI. */
  liveComps: boolean;
}

/** A month of freshness. A property's trailing-twelve comps do not
 *  move week to week, and every day of TTL is an address nobody pays
 *  for twice. */
const ESTIMATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function withLiveComps(
  analysis: Analysis,
  point: { lat: number; lon: number } | null
): Promise<CompsResolution> {
  if (!point || !hasAirRoiKey()) return { analysis, liveComps: false };

  const spec = {
    lat: point.lat,
    lon: point.lon,
    bedrooms: analysis.bedrooms,
    baths: analysis.bathrooms,
    guests: Math.max(2, analysis.bedrooms * 2),
  };

  // The store before the wallet. A hit costs one database read and no
  // billed call at all, and it survives deploys — which the framework
  // cache underneath this does not.
  const cached = await readEstimate(estimateKey(spec)).catch(() => null);
  if (cached && isFresh(cached.at, ESTIMATE_TTL_MS)) {
    const comps = cached.estimate.comps as StrComp[];
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
    if (estimate.comps.length < MIN_COMPS) return { analysis, liveComps: false };
    commitLiveSearch(key);

    // Just paid for this; make it the last time. A write failure is
    // survivable — the answer still renders — but it means the next
    // visitor buys the same address again, so it is not ignored
    // silently the way a pure cache write would be.
    await writeEstimate(estimateKey(spec), {
      comps: estimate.comps,
      monthlyRevenue: estimate.monthlyRevenue,
      revenue: estimate.revenue,
      adr: estimate.adr,
      occupancy: estimate.occupancy,
    }).catch(() => ({ ok: false, detail: "write threw" }));
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
