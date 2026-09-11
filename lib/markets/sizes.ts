/**
 * What size of unit to lease in a market — from listings, for nothing.
 *
 * This is the question an arbitrage operator actually opens a market
 * with. Not "is January busier than July" but "do two-beds or three-
 * beds clear more here, and what do they cost to lease". Both halves of
 * that are already on hand and neither costs a call: the short-let side
 * comes from the comp pool every analysis in the city leaves behind,
 * the long-let side from the rentals a Deal Finder search brought in.
 *
 * A SAMPLE, AND SAID SO. The comps are the listings this product has
 * encountered, not a census of the market, and the rentals are what was
 * listed the last time somebody searched. Both are real listings and
 * neither is the whole supply, which is why every row carries its count
 * and why a size with too few of either shows a dash rather than a
 * median of two things.
 *
 * Pure: medians and arithmetic. The reading lives in the page.
 */

import { median, MIN_COMPS } from "./areas";
import type { PoolComp } from "@/lib/live/comp-pool";
import type { RentalListing } from "@/lib/mock/types";

/** Nights a year, the same 365 the calculator and the feed's own
 *  revenue field use. */
const NIGHTS_A_YEAR = 365;

/**
 * Rentals of one size before its asking rent is shown.
 *
 * Lower than the short-let floor on purpose: an asking rent is a
 * published number on a real unit rather than an estimate of a market,
 * so three of them say something where three nightly rates would not.
 * The count sits beside it either way.
 */
export const MIN_RENTALS = 3;

/** Everything at or above this is one row. Five-bedroom arbitrage is
 *  rare enough that splitting six from seven would be two empty rows
 *  where one thin one tells the truth. */
export const MAX_BEDROOMS = 5;

export interface SizeRow {
  /** 0 is a studio; MAX_BEDROOMS means that many or more. */
  bedrooms: number;
  label: string;
  /** Short-let listings seen at this size. */
  comps: number;
  /** Medians of those — null until there are MIN_COMPS. */
  adr: number | null;
  occupancy: number | null;
  /** A year at that rate and that occupancy. */
  revenue: number | null;
  /** Long-let listings on the market at this size. */
  rentals: number;
  /** Median asking lease — null until there are MIN_RENTALS. */
  rent: number | null;
  /** That year less a year of that lease. Null without both halves:
   *  half a spread is not a spread. */
  spread: number | null;
}

export function sizeLabel(bedrooms: number): string {
  if (bedrooms <= 0) return "Studio";
  if (bedrooms >= MAX_BEDROOMS) return `${MAX_BEDROOMS}+ bd`;
  return `${bedrooms} bd`;
}

function bucket(bedrooms: number): number {
  const bd = Math.max(0, Math.round(bedrooms));
  return Math.min(bd, MAX_BEDROOMS);
}

export interface BuildSizesInput {
  comps: readonly PoolComp[];
  listings: readonly RentalListing[];
}

/**
 * One row per bedroom count, sizes nobody has anything for left out.
 *
 * A row survives on either side alone — a size with rentals and no
 * comps still tells somebody what it costs to lease there, and a size
 * with comps and no rentals still tells them what it earns.
 */
export function buildSizes({ comps, listings }: BuildSizesInput): SizeRow[] {
  const adrs = new Map<number, number[]>();
  const occs = new Map<number, number[]>();
  const rents = new Map<number, number[]>();

  const push = (map: Map<number, number[]>, key: number, value: number) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };

  for (const c of comps) {
    if (!(c.adr > 0)) continue;
    const bd = bucket(c.bd);
    push(adrs, bd, c.adr);
    push(occs, bd, c.occ);
  }
  for (const l of listings) {
    if (!(l.rentMonthly > 0)) continue;
    push(rents, bucket(l.bedrooms), l.rentMonthly);
  }

  const sizes = [...new Set([...adrs.keys(), ...rents.keys()])].sort((a, b) => a - b);
  return sizes.map((bd) => {
    const compList = adrs.get(bd) ?? [];
    const rentList = rents.get(bd) ?? [];
    const enough = compList.length >= MIN_COMPS;
    const adr = enough ? median(compList) : null;
    const occupancy = enough ? median(occs.get(bd) ?? []) : null;
    const revenue =
      adr !== null && occupancy !== null
        ? Math.round(adr * occupancy * NIGHTS_A_YEAR)
        : null;
    const rent =
      rentList.length >= MIN_RENTALS ? Math.round(median(rentList) ?? 0) : null;
    return {
      bedrooms: bd,
      label: sizeLabel(bd),
      comps: compList.length,
      adr: adr === null ? null : Math.round(adr),
      occupancy,
      revenue,
      rentals: rentList.length,
      rent,
      spread:
        revenue === null || rent === null ? null : Math.round(revenue - rent * 12),
    };
  });
}

/** The size with the widest spread — what a market's page leads with.
 *  Null when no size has both halves. */
export function bestSize(rows: readonly SizeRow[]): SizeRow | null {
  let best: SizeRow | null = null;
  for (const row of rows) {
    if (row.spread === null) continue;
    if (!best || row.spread > (best.spread ?? -Infinity)) best = row;
  }
  return best;
}
