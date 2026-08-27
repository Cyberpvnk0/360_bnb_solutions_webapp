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
 */

import { fetchEstimate, hasAirRoiKey } from "@/lib/live/airroi";
import { checkLiveSearch, commitLiveSearch } from "@/lib/live/quota";
import type { Analysis } from "@/lib/mock/types";

/** Below this a comp set can't carry a projection honestly. */
const MIN_COMPS = 4;

export interface CompsResolution {
  analysis: Analysis;
  /** True when the comps on screen came from AirROI. */
  liveComps: boolean;
}

export async function withLiveComps(
  analysis: Analysis,
  point: { lat: number; lon: number } | null
): Promise<CompsResolution> {
  if (!point || !hasAirRoiKey()) return { analysis, liveComps: false };

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
    const estimate = await fetchEstimate({
      lat: point.lat,
      lon: point.lon,
      bedrooms: analysis.bedrooms,
      baths: analysis.bathrooms,
      guests: Math.max(2, analysis.bedrooms * 2),
    });
    if (estimate.comps.length < MIN_COMPS) return { analysis, liveComps: false };
    commitLiveSearch(key);
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
    return { analysis, liveComps: false };
  }
}
