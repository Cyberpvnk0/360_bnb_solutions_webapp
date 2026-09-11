/**
 * The areas inside a market, built only from listings that exist.
 *
 * A market page has to answer "which part of this city" and the only
 * honest way to answer it is with the real rows the product already
 * holds: the long-term rentals a Deal Finder search brought in, which
 * carry a ZIP, and the short-let listings every analysis in the city
 * leaves in the comp pool, which carry a coordinate. Both are real
 * listings somebody could open.
 *
 * SO THE AREA IS A ZIP, NOT A NEIGHBOURHOOD. The catalogue can generate
 * a list of neighbourhood names and figures to go with them, and that
 * list reads beautifully and is invented end to end — invented names
 * outside a handful of cities, invented coordinates in all of them, and
 * invented rates under both. None of it is in here. A ZIP is a real
 * boundary, it is the granularity the short-let feed itself answers at,
 * and every figure below is a median of rows that were actually seen in
 * it.
 *
 * WHAT IS SEEN IS NOT WHAT EXISTS. The comp count is the listings this
 * product has encountered in that ZIP, not a census of it, and the
 * table says so rather than letting a reader take twelve for the whole
 * supply. A measured row — bought from the feed at ZIP scope — is the
 * one that carries a true active-listing count, and rows say which they
 * are.
 *
 * Everything here is pure: coordinates, medians and sorting. The
 * reading and the buying live in the page and the route.
 */

import { zipOf } from "@/lib/live/zip";
import type { PoolComp } from "@/lib/live/comp-pool";
import type { RentalListing } from "@/lib/mock/types";

/** Nights a year a short-let listing is offered, for turning a rate and
 *  an occupancy into an annual figure. The same 365 the calculator and
 *  the feed's own revenue field use. */
const NIGHTS_A_YEAR = 365;

/**
 * How far a short-let listing may be from a ZIP's centre and still be
 * counted in it.
 *
 * Comps carry a coordinate and no ZIP, so they are assigned to the
 * nearest ZIP this market has rentals in. Four miles is roughly an
 * urban ZIP across; past it the nearest centre is a guess rather than a
 * placement, and a guess belongs nowhere.
 */
export const ASSIGN_RADIUS_MILES = 4;

/**
 * Listings a ZIP needs before its rates are shown.
 *
 * A median of two listings is not an area's rate, it is two listings.
 * Below this the row still appears — the count is itself worth seeing —
 * with dashes where the figures would be.
 */
export const MIN_COMPS = 5;

/** What the feed measured for one ZIP, when somebody bought it. */
export interface MeasuredArea {
  adr: number | null;
  occupancy: number | null;
  revenue: number | null;
  revpar: number | null;
  activeListings: number | null;
  /** The feed's own name for the ZIP. */
  fullName: string | null;
  at: string | null;
}

export interface AreaRow {
  zip: string;
  /** The town the real rows in this ZIP name, when they agree on one
   *  that is not the market's own name. Null otherwise. */
  town: string | null;
  /** The centre of the real rows in it. */
  lat: number;
  lon: number;
  /** Long-term rentals on the market here, from the last search. */
  rentals: number;
  /** Median asking lease across them, and across the two-beds alone. */
  medianRent: number | null;
  rent2br: number | null;
  /** Short-let listings seen here. A sample, never a census. */
  comps: number;
  /** Medians of those listings — null until there are MIN_COMPS. */
  adr: number | null;
  occupancy: number | null;
  /** A year at that rate and that occupancy. */
  revenue: number | null;
  /** That year less a year of the median two-bed lease here. Null
   *  without both halves: half a spread is not a spread. */
  spread: number | null;
  /** The feed's own figures for this ZIP, when they were bought. */
  measured: MeasuredArea | null;
}

/* ------------------------------------------------------------------ */
/* Geometry and statistics                                             */
/* ------------------------------------------------------------------ */

const EARTH_MILES = 3958.8;

export function milesApart(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The middle value, or the mean of the middle two. Empty gives null. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* ------------------------------------------------------------------ */
/* Building the rows                                                   */
/* ------------------------------------------------------------------ */

interface Bucket {
  zip: string;
  towns: Map<string, number>;
  lats: number[];
  lons: number[];
  rents: number[];
  rents2br: number[];
}

/** The town most of a ZIP's rows name, when it is not the market's. */
function townOf(towns: Map<string, number>, marketName: string): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [town, count] of towns) {
    if (count > bestCount) {
      best = town;
      bestCount = count;
    }
  }
  if (!best) return null;
  return best.toLowerCase() === marketName.toLowerCase() ? null : best;
}

export interface BuildAreasInput {
  market: { name: string };
  /** The rentals the store holds for this market. */
  listings: readonly RentalListing[];
  /** The short-let listings every analysis here has left behind. */
  comps: readonly PoolComp[];
  /** ZIPs bought from the feed, by ZIP. */
  measured?: ReadonlyMap<string, MeasuredArea>;
}

/**
 * One row per ZIP this market has real rentals in.
 *
 * The rentals define the ZIPs and their centres, because they are the
 * rows that carry a ZIP at all. Comps are then placed into the nearest
 * of those centres, which is why a market with no rental inventory
 * yields no areas even when its comp pool is full: there would be
 * nothing to name the areas after.
 */
export function buildAreas({
  market,
  listings,
  comps,
  measured,
}: BuildAreasInput): AreaRow[] {
  const buckets = new Map<string, Bucket>();
  for (const l of listings) {
    const zip = zipOf(l);
    if (!zip) continue;
    let b = buckets.get(zip);
    if (!b) {
      b = { zip, towns: new Map(), lats: [], lons: [], rents: [], rents2br: [] };
      buckets.set(zip, b);
    }
    if (l.city) b.towns.set(l.city, (b.towns.get(l.city) ?? 0) + 1);
    if (Number.isFinite(l.lat) && Number.isFinite(l.lon)) {
      b.lats.push(l.lat);
      b.lons.push(l.lon);
    }
    if (l.rentMonthly > 0) {
      b.rents.push(l.rentMonthly);
      if (l.bedrooms === 2) b.rents2br.push(l.rentMonthly);
    }
  }

  const centres = [...buckets.values()].map((b) => ({
    bucket: b,
    lat: median(b.lats) ?? 0,
    lon: median(b.lons) ?? 0,
    placed: [] as PoolComp[],
  }));
  const locatable = centres.filter((c) => c.bucket.lats.length > 0);

  for (const comp of comps) {
    let best: (typeof locatable)[number] | null = null;
    let bestMiles = Infinity;
    for (const c of locatable) {
      const miles = milesApart(comp, c);
      if (miles < bestMiles) {
        best = c;
        bestMiles = miles;
      }
    }
    if (best && bestMiles <= ASSIGN_RADIUS_MILES) best.placed.push(comp);
  }

  return centres.map((c) => {
    const b = c.bucket;
    const enough = c.placed.length >= MIN_COMPS;
    const adr = enough ? median(c.placed.map((p) => p.adr)) : null;
    const occupancy = enough ? median(c.placed.map((p) => p.occ)) : null;
    const revenue =
      adr !== null && occupancy !== null
        ? Math.round(adr * occupancy * NIGHTS_A_YEAR)
        : null;
    const rent2br = median(b.rents2br);
    return {
      zip: b.zip,
      town: townOf(b.towns, market.name),
      lat: c.lat,
      lon: c.lon,
      rentals: b.rents.length,
      medianRent: median(b.rents),
      rent2br,
      comps: c.placed.length,
      adr: adr === null ? null : Math.round(adr),
      occupancy,
      revenue,
      spread:
        revenue === null || rent2br === null
          ? null
          : Math.round(revenue - rent2br * 12),
      measured: measured?.get(b.zip) ?? null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Ranking                                                             */
/* ------------------------------------------------------------------ */

export type AreaSort =
  | "revenue"
  | "occupancy"
  | "adr"
  | "listings"
  | "rent"
  | "spread";

export const AREA_SORTS: { id: AreaSort; label: string; hint: string }[] = [
  { id: "revenue", label: "Revenue", hint: "A year at the rate and occupancy seen here, highest first." },
  { id: "occupancy", label: "Occupancy", hint: "The share of nights listings here are booked." },
  { id: "adr", label: "Nightly rate", hint: "The middle nightly rate of the listings seen here." },
  { id: "listings", label: "Listings", hint: "How many short-let listings this product has seen here." },
  { id: "spread", label: "Spread", hint: "A year of letting less a year of the median two-bed lease." },
  { id: "rent", label: "Cheapest rent", hint: "The median asking lease here, lowest first." },
];

/**
 * A figure a row can be ranked on, preferring what the feed measured
 * over what was seen — a bought row is the better answer to the same
 * question, and mixing them within one column would be worse than
 * either.
 */
function value(row: AreaRow, sort: AreaSort): number | null {
  switch (sort) {
    case "revenue":
      return row.measured?.revenue ?? row.revenue;
    case "occupancy":
      return row.measured?.occupancy ?? row.occupancy;
    case "adr":
      return row.measured?.adr ?? row.adr;
    case "listings":
      return row.measured?.activeListings ?? (row.comps > 0 ? row.comps : null);
    case "rent":
      return row.medianRent;
    case "spread":
      return row.spread;
  }
}

/** Ascending for rent, descending for everything else, and a row with
 *  no figure sorts last either way rather than reading as a zero. */
export function sortAreas(rows: readonly AreaRow[], sort: AreaSort): AreaRow[] {
  const ascending = sort === "rent";
  return [...rows].sort((a, b) => {
    const x = value(a, sort);
    const y = value(b, sort);
    if (x === null && y === null) return a.zip.localeCompare(b.zip);
    if (x === null) return 1;
    if (y === null) return -1;
    return (ascending ? x - y : y - x) || a.zip.localeCompare(b.zip);
  });
}

/** How a ZIP's figure compares with the market's — the "vs market"
 *  column. Null when either side is missing. */
export function versusMarket(
  area: number | null,
  marketValue: number | null | undefined
): number | null {
  if (area === null || marketValue == null || marketValue <= 0) return null;
  return area / marketValue - 1;
}
