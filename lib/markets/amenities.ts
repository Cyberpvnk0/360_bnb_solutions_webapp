/**
 * What the earners in a market have that the others do not.
 *
 * THE ONE LEVER AN ARBITRAGE OPERATOR ACTUALLY PULLS. The building is
 * somebody else's and the rent is what it is; what the operator chooses
 * is how the unit is furnished. So the question worth answering on a
 * market page is not "what does a listing here earn" — the headline
 * figures already say — but "what do the listings here that earn more
 * have in them".
 *
 * BUILT FROM WHAT IS ALREADY BOUGHT. Every analysis anybody runs drops
 * its comps into the market's pool, amenities included (lib/live/
 * comp-pool), so this costs nothing and gets better the more the market
 * is used. It is a sample of the listings this product has seen, never
 * a census of the market, and the counts are shown so nobody can mistake
 * one for the other.
 *
 * HONEST ABOUT THE CONFOUND. Pools and hot tubs sit on larger houses,
 * and larger houses earn more whatever is in the garden. Comparing
 * everything with a pool against everything without would hand back the
 * bedroom count wearing a pool's name. So every comparison here runs
 * INSIDE ONE BEDROOM BAND — the best-represented one — and the band is
 * reported with the answer. Like for like, or not at all.
 *
 * AND ABOUT WHAT IT IS NOT. A gap between two medians is an association.
 * It is not a promise that installing the thing moves the number, and
 * nothing here calls it one.
 */

import { annualRevenueFromAdr } from "@/lib/calc/arbitrage";
import { median } from "@/lib/markets/areas";

/** Listings needed on EACH side before a comparison is drawn at all. */
export const MIN_SIDE = 5;

/**
 * Amenities on this share or more of the band are dropped.
 *
 * Not because the arithmetic breaks — MIN_SIDE already guards that —
 * but because a thing nearly every listing has is not a decision. "Wifi
 * earns 4% more" is noise wearing a recommendation's clothes.
 */
export const UBIQUITY = 0.9;

/** How many rows the panel is willing to show. */
export const TOP_AMENITIES = 8;

/** One comp, reduced to what this question needs. */
export interface AmenityComp {
  bd: number;
  adr: number;
  /** Fraction. */
  occ: number;
  am?: string[];
}

export interface AmenityRow {
  /** The amenity, as the platform names it, lowercased. */
  amenity: string;
  /** Listings in the band that advertise it, and that do not. */
  withCount: number;
  withoutCount: number;
  /** Median annual revenue of each group. */
  withRevenue: number;
  withoutRevenue: number;
  /** The gap as a fraction of the group without it. */
  lift: number;
}

export interface AmenityReading {
  /** The bedroom band every row was compared inside. */
  bedrooms: number;
  /** Listings in that band — the sample every row is drawn from. */
  sample: number;
  rows: AmenityRow[];
}

/** The bedroom band with the most listings CARRYING amenities: a band
 *  of forty comps that predate amenity reading answers nothing. */
function bestBand(comps: readonly AmenityComp[]): number | null {
  const counts = new Map<number, number>();
  for (const c of comps) {
    if (!c.am?.length) continue;
    counts.set(c.bd, (counts.get(c.bd) ?? 0) + 1);
  }
  let band: number | null = null;
  let best = 0;
  for (const [bd, n] of counts) {
    // Ties go to the smaller unit: it is the one an arbitrage operator
    // is more likely to be able to lease.
    if (n > best || (n === best && band !== null && bd < band)) {
      best = n;
      band = bd;
    }
  }
  return best >= MIN_SIDE * 2 ? band : null;
}

/**
 * Read a market's pool for what the earners have.
 *
 * Returns null rather than a thin answer: a market whose pool cannot
 * support a like-for-like comparison should say so, not show one row
 * built from six listings and let it look like the others.
 */
export function readAmenities(comps: readonly AmenityComp[]): AmenityReading | null {
  const bedrooms = bestBand(comps);
  if (bedrooms === null) return null;

  // Only listings that carried an amenity list at all. One that did not
  // is not a listing without a hot tub — it is a listing we never asked,
  // and counting it as a "without" would drag every median toward the
  // ones bought before amenities were read.
  const band = comps.filter(
    (c) => c.bd === bedrooms && c.am !== undefined && c.adr > 0 && c.occ > 0
  );
  if (band.length < MIN_SIDE * 2) return null;

  const revenueOf = (c: AmenityComp) => annualRevenueFromAdr(c.adr, c.occ);
  const names = new Set<string>();
  for (const c of band) for (const a of c.am ?? []) names.add(a);

  const rows: AmenityRow[] = [];
  for (const amenity of names) {
    const withIt = band.filter((c) => c.am!.includes(amenity));
    const withoutIt = band.filter((c) => !c.am!.includes(amenity));
    if (withIt.length < MIN_SIDE || withoutIt.length < MIN_SIDE) continue;
    if (withIt.length / band.length >= UBIQUITY) continue;

    const withRevenue = median(withIt.map(revenueOf));
    const withoutRevenue = median(withoutIt.map(revenueOf));
    if (withRevenue === null || withoutRevenue === null || withoutRevenue <= 0) continue;

    rows.push({
      amenity,
      withCount: withIt.length,
      withoutCount: withoutIt.length,
      withRevenue: Math.round(withRevenue),
      withoutRevenue: Math.round(withoutRevenue),
      lift: Math.round(((withRevenue - withoutRevenue) / withoutRevenue) * 1000) / 1000,
    });
  }
  if (rows.length === 0) return null;

  // Biggest gap first, and ties by sample so the better-evidenced row
  // of two equal claims is the one a reader sees.
  rows.sort((a, b) => b.lift - a.lift || b.withCount - a.withCount);
  return { bedrooms, sample: band.length, rows: rows.slice(0, TOP_AMENITIES) };
}

/** "2 bed", "Studio" — the band, as a reader says it. */
export function bandLabel(bedrooms: number): string {
  return bedrooms === 0 ? "Studio" : `${bedrooms} bed`;
}
