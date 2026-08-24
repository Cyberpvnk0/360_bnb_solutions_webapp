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

import { fetchComps, hasAirRoiKey } from "@/lib/live/airroi";
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
    const comps = await fetchComps({
      lat: point.lat,
      lon: point.lon,
      bedrooms: analysis.bedrooms,
    });
    if (comps.length < MIN_COMPS) return { analysis, liveComps: false };
    commitLiveSearch(key);
    return { analysis: { ...analysis, strComps: comps }, liveComps: true };
  } catch {
    return { analysis, liveComps: false };
  }
}
