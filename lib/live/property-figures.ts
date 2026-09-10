/**
 * A property's own figures, when an analysis has been run on it.
 *
 * The analyzer buys a comp set around the property and projects from
 * it; the set is kept in the shared store, under the point it was
 * bought at and under the property's address. A Deal Finder card for
 * the same property reads that set back and projects from the same
 * figures — the finest grain there is, and exactly what the analyzer
 * says, so the panel and the page it opens cannot disagree. One
 * analysis, by anyone, and every account's card for that property
 * stands on it from then on.
 *
 * KEPT FOR AS LONG AS IT IS THE NEWEST WORD. The analyzer buys a set
 * again after a month; a card does not, because a card buys nothing.
 * It stands on the newest set on file at any age — a real analysis
 * of this property, months old, beats an estimate from the listings
 * around it — and moves to the newer one the moment the analyzer
 * writes it.
 *
 * A read of the store, never a purchase: the comps are bought only
 * where the plan meters them, on the analyzer. A property nobody has
 * analyzed has no figures here, and the card falls to the listings
 * around it (lib/live/comp-pool).
 */

import { deriveMarketAssumptions, MIN_COMPS, selectNearbyComps } from "@/lib/calc/comps";
import { estimateKey, readEstimates, type StoredEstimate } from "@/lib/db/market-store";
import type { StrComp } from "@/lib/mock/types";
import { addressEstimateKey, compsSpecFor } from "./str-comps";

export { addressEstimateKey } from "./str-comps";

export interface PropertyFigures {
  /** This size's own nightly rate, the comps' mean. */
  adr: number;
  /** Fraction. */
  occupancy: number;
  comps: number;
  /** How far the comps the figures stand on reach, in miles. */
  radiusMiles: number;
  at: string | null;
}

/**
 * The oldest stored format a card will stand on. Sets before it could
 * hold listings the feed had marked as gone, or rooms rather than
 * whole places, with nothing in the set saying which — see
 * ESTIMATE_VERSION in lib/live/str-comps.
 */
export const CARD_MIN_VERSION = 4;

export interface PropertySpec {
  lat: number;
  lon: number;
  bedrooms: number;
  bathrooms: number;
  /** The street line, when the caller has one. */
  address?: string | null;
  /** Two letters. */
  stateCode?: string | null;
}

/** The store's key for a property's comp set at this size, by point. */
export function propertyEstimateKey(spec: PropertySpec): string {
  return estimateKey(
    compsSpecFor({ bedrooms: spec.bedrooms, bathrooms: spec.bathrooms }, { lat: spec.lat, lon: spec.lon })
  );
}

/** Every key a property's set may sit under. */
export function propertyEstimateKeys(spec: PropertySpec): string[] {
  const byAddress = addressEstimateKey(spec);
  return byAddress ? [propertyEstimateKey(spec), byAddress] : [propertyEstimateKey(spec)];
}

export type StoredSet = { estimate: StoredEstimate; at: string | null };

/**
 * The figures a stored comp set carries, exactly as the analyzer
 * derives them — the same subset, the same means — or null when the
 * set is in a format too old to stand on, or too thin.
 */
export function propertyFiguresFrom(cached: StoredSet | null | undefined): PropertyFigures | null {
  if (!cached || (cached.estimate.v ?? 1) < CARD_MIN_VERSION) return null;
  const held = (cached.estimate.comps as StrComp[]).filter((c) => c && c.active !== false);
  const { comps, radiusMiles } = selectNearbyComps(held);
  if (comps.length < MIN_COMPS) return null;
  const { adr, marketOccupancy } = deriveMarketAssumptions(comps);
  return { adr, occupancy: marketOccupancy, comps: comps.length, radiusMiles, at: cached.at };
}

/** The newest usable set among several — the one the analyzer would
 *  write last wins, whichever key it sits under. */
export function newestPropertyFigures(
  sets: readonly (StoredSet | null | undefined)[]
): PropertyFigures | null {
  let best: PropertyFigures | null = null;
  for (const set of sets) {
    const figures = propertyFiguresFrom(set);
    if (!figures) continue;
    if (!best || (figures.at ?? "") > (best.at ?? "")) best = figures;
  }
  return best;
}

export async function propertyFigures(spec: PropertySpec): Promise<PropertyFigures | null> {
  const keys = propertyEstimateKeys(spec);
  const sets = await readEstimates(keys).catch(() => new Map<string, StoredSet>());
  return newestPropertyFigures(keys.map((k) => sets.get(k)));
}
