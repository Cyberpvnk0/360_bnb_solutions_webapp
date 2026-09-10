/**
 * A property's own figures, when an analysis has been run on it.
 *
 * The analyzer buys a comp set around the property and projects from
 * it; the set is kept a month in the shared store. A Deal Finder card
 * for the same property can read that set back and project from the
 * same figures — the finest grain there is, and exactly what the
 * analyzer says, so the panel and the page it opens cannot disagree.
 *
 * A read of the store, never a purchase: the comps are bought only
 * where the plan meters them, on the analyzer. A property nobody has
 * analyzed has no figures here, and the panel falls to the ZIP's.
 */

import { deriveMarketAssumptions } from "@/lib/calc/comps";
import { estimateKey, isFresh, readEstimate } from "@/lib/db/market-store";
import type { StrComp } from "@/lib/mock/types";
import { compsSpecFor, ESTIMATE_TTL_MS, ESTIMATE_VERSION, MIN_COMPS } from "./str-comps";

export interface PropertyFigures {
  /** This size's own nightly rate, the comps' mean. */
  adr: number;
  /** Fraction. */
  occupancy: number;
  comps: number;
  at: string | null;
}

export async function propertyFigures(spec: {
  lat: number;
  lon: number;
  bedrooms: number;
  bathrooms: number;
}): Promise<PropertyFigures | null> {
  const key = estimateKey(
    compsSpecFor({ bedrooms: spec.bedrooms, bathrooms: spec.bathrooms }, { lat: spec.lat, lon: spec.lon })
  );
  const cached = await readEstimate(key).catch(() => null);
  if (!cached || !isFresh(cached.at, ESTIMATE_TTL_MS) || cached.estimate.v !== ESTIMATE_VERSION) {
    return null;
  }
  const comps = (cached.estimate.comps as StrComp[]).filter((c) => c && c.active !== false);
  if (comps.length < MIN_COMPS) return null;
  const { adr, marketOccupancy } = deriveMarketAssumptions(comps);
  return { adr, occupancy: marketOccupancy, comps: comps.length, at: cached.at };
}
