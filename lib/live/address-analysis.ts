/**
 * A typed address, turned into a real analysis.
 *
 * What this replaces was a stub that said so: `searchAddresses` filtered
 * a hardcoded list of invented addresses, and `runAddressPull` waited
 * two seconds and returned one of thirty seeded analyses regardless of
 * what had been typed. The product's whole promise is address in,
 * projection out, and the address went nowhere.
 *
 * Now: the address is geocoded, the point picks its nearest covered
 * market, and the analysis is assembled around that point. The comps
 * come from the live feed for those exact coordinates through
 * withLiveComps, the same path the seeded analyses use — so a searched
 * property and a saved one are the same object by the time anything
 * renders one.
 *
 * The market supplies context the address cannot: local regulation, the
 * terrain, and a median lease to start the calculator from WHEN NOBODY
 * KNOWS THE REAL ONE. A listing handed over from the Deal Finder does
 * know it, and its asking rent displaces the median outright — see
 * AddressSpec.rentMonthly. Everything else property-specific comes from
 * what the person actually entered.
 */

import { MARKETS, MARKET_BY_SLUG } from "@/lib/mock/markets";
import { buildLtrCompsFor, buildDefaultsFor } from "@/lib/mock/analyses";
import type { Analysis, Market, PropertyType } from "@/lib/mock/types";

export interface AddressSpec {
  address: string;
  lat: number;
  lon: number;
  bedrooms: number;
  bathrooms: number;
  propertyType: PropertyType;
  /**
   * The property's own asking rent, when a listing supplied one.
   *
   * Absent for a typed address, which has no listing behind it and
   * genuinely has to be estimated from comparable leases. Present, it
   * OVERRIDES that estimate: it is what this lease costs rather than
   * what places like it cost, and every figure the page derives stands
   * on it.
   */
  rentMonthly?: number;
  /** The unit's own city and state, when a listing supplied them. The
   *  market's name stands in otherwise, which is right for a typed
   *  address and wrong for a listing in a suburb the market covers. */
  city?: string;
  stateCode?: string;
}

const EARTH_RADIUS_MILES = 3958.8;

function milesBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The covered market a point belongs to, and how far away it is.
 *
 * Distance is returned rather than swallowed because it is the honest
 * caveat: a property forty miles from the nearest market in the
 * catalogue borrows that market's regulation and median rent, and
 * whoever reads the result deserves to know how far those travelled.
 */
export function nearestMarket(point: { lat: number; lon: number }): {
  market: Market;
  milesAway: number;
} {
  let best = MARKETS[0];
  let bestMiles = Infinity;
  for (const m of MARKETS) {
    const miles = milesBetween(point, { lat: m.lat, lon: m.lon });
    if (miles < bestMiles) {
      best = m;
      bestMiles = miles;
    }
  }
  return { market: best, milesAway: Math.round(bestMiles * 10) / 10 };
}

/** A stable id for the same address and property shape, so reloading a
 *  result does not produce a different one. */
export function addressAnalysisId(spec: AddressSpec): string {
  const key = `${spec.address}|${spec.bedrooms}|${spec.bathrooms}|${spec.propertyType}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return `addr--${(hash >>> 0).toString(36)}`;
}

/**
 * The analysis skeleton for a searched address.
 *
 * `strComps` is deliberately EMPTY. Comps arrive from the live feed for
 * this exact point, and seeding the array with invented ones would mean
 * a failed lookup renders a full projection built on nothing — the
 * worst outcome available here, since it is indistinguishable from a
 * real one. An empty set makes the caller decide, out loud.
 */
export function buildAddressAnalysis(
  spec: AddressSpec,
  marketSlug?: string
): { analysis: Analysis; market: Market; milesAway: number } {
  const explicit = marketSlug ? MARKET_BY_SLUG.get(marketSlug) : undefined;
  const { market, milesAway } = explicit
    ? { market: explicit, milesAway: 0 }
    : nearestMarket({ lat: spec.lat, lon: spec.lon });

  const id = addressAnalysisId(spec);
  const ltrComps = buildLtrCompsFor(market, spec.bedrooms, id);

  return {
    analysis: {
      id,
      address: spec.address,
      city: spec.city?.trim() || market.name,
      stateCode: spec.stateCode?.trim() || market.stateCode,
      marketSlug: market.slug,
      bedrooms: spec.bedrooms,
      bathrooms: spec.bathrooms,
      propertyType: spec.propertyType,
      /**
       * A bare YYYY-MM-DD, matching the seeded analyses.
       *
       * fmtDate appends "T00:00:00" to whatever it is handed — the
       * convention across this data is a plain date, not a timestamp —
       * so a full ISO string became "…ZT00:00:00" and rendered as
       * "Invalid Date". Harmless where it was showing, and not harmless
       * at all once a searched property is saved into the pipeline,
       * which reads the same field.
       */
      createdAt: new Date().toISOString().slice(0, 10),
      strComps: [],
      ltrComps,
      // The asking rent when a listing gave one, the comp median when
      // nobody did. Never a blend of the two, and the caller says which
      // it got so the page can say so too.
      defaults: buildDefaultsFor(ltrComps, spec.bedrooms, id, spec.rentMonthly),
    },
    market,
    milesAway,
  };
}
