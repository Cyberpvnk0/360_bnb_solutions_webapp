/**
 * Lease evidence: the real rentals listed near a property.
 *
 * This table used to be generated. Six rows of "5745 Willow Ct" at a
 * jittered median rent, with a distance drawn from a random number and
 * a status rotating through "Active listing", "Pending application",
 * "Leased 34 days ago" — under a heading that said what landlords are
 * asking. It read exactly like six real leases somebody could go and
 * check, and not one of the addresses existed.
 *
 * What it is now: the rentals this product already holds for the
 * market, which came from the live feed the Deal Finder searches, cut
 * to the ones near this property and closest to its size. Every row is
 * a listing somebody can open. None of it costs a call — the rows are
 * the ones a search already paid for.
 *
 * ACTIVE ONLY, WHICH IS WHAT THE FEED RETURNS. A lease that has already
 * gone is not evidence of what this one can be signed for, and the old
 * statuses invented two kinds of gone. Nothing here carries a status
 * because every row has the same one.
 *
 * Pure: distance, sorting and medians. The reading lives in the page.
 */

import { milesApart } from "@/lib/markets/areas";
import { zipOf } from "@/lib/live/zip";
import type { RentalListing } from "@/lib/mock/types";

/** How many rows the table shows. Enough to see a range, few enough to
 *  read without scrolling. */
export const EVIDENCE_ROWS = 6;

/**
 * How far a rental may be and still be evidence about this address.
 *
 * Ten miles is generous for a metro and about right for the small
 * markets this strategy is often run in. Past it the rent says more
 * about the other town than about this street.
 */
export const EVIDENCE_RADIUS_MILES = 10;

export interface LeaseComp {
  id: string;
  address: string;
  city: string;
  stateCode: string;
  zip: string | null;
  bedrooms: number;
  bathrooms: number;
  rent: number;
  /** Absent on rows whose feed did not state one — never a zero. */
  sqft: number | null;
  distanceMiles: number;
  /** Days since it was listed, where the feed said. */
  daysOnMarket: number | null;
  /** The listing's own page, when there is one. */
  sourceUrl: string | null;
}

export interface LeaseEvidenceInput {
  /** The rentals held for this market — real rows from a live search. */
  listings: readonly RentalListing[];
  /** Where the property is. Without one there is no evidence to give:
   *  "nearby" is the whole claim the table makes. */
  point: { lat: number; lon: number } | null;
  /** The property's size. Rows are ranked by how close they come to
   *  it before how close they are to it. */
  bedrooms: number;
  /** The property itself, when it came from this same inventory — its
   *  own listing is not evidence about itself. */
  excludeId?: string | null;
  limit?: number;
}

/**
 * The nearest comparable leases, closest size first.
 *
 * Size before distance, because a one-bed two streets away says less
 * about a three-bed than a three-bed a mile off does. Within a size
 * band, distance decides.
 */
export function buildLeaseEvidence({
  listings,
  point,
  bedrooms,
  excludeId,
  limit = EVIDENCE_ROWS,
}: LeaseEvidenceInput): LeaseComp[] {
  if (!point) return [];
  const scored: { comp: LeaseComp; band: number }[] = [];
  for (const l of listings) {
    if (excludeId && l.id === excludeId) continue;
    if (!(l.rentMonthly > 0)) continue;
    if (!Number.isFinite(l.lat) || !Number.isFinite(l.lon)) continue;
    const distanceMiles = milesApart(point, l);
    if (distanceMiles > EVIDENCE_RADIUS_MILES) continue;
    scored.push({
      band: Math.abs(l.bedrooms - bedrooms),
      comp: {
        id: l.id,
        address: l.address,
        city: l.city,
        stateCode: l.stateCode,
        zip: zipOf(l) ?? null,
        bedrooms: l.bedrooms,
        bathrooms: l.bathrooms,
        rent: l.rentMonthly,
        sqft: l.sqft > 0 ? l.sqft : null,
        distanceMiles: Math.round(distanceMiles * 10) / 10,
        daysOnMarket:
          typeof l.daysOnMarket === "number" && l.daysOnMarket >= 0
            ? l.daysOnMarket
            : null,
        sourceUrl: l.sourceUrl ?? null,
      },
    });
  }
  scored.sort(
    (a, b) =>
      a.band - b.band ||
      a.comp.distanceMiles - b.comp.distanceMiles ||
      a.comp.rent - b.comp.rent
  );
  return scored.slice(0, limit).map((s) => s.comp);
}

/** The middle asking rent of what is on the table, or null for none. */
export function medianRent(comps: readonly LeaseComp[]): number | null {
  if (comps.length === 0) return null;
  const rents = comps.map((c) => c.rent).sort((a, b) => a - b);
  const mid = rents.length >> 1;
  return rents.length % 2 === 1
    ? rents[mid]
    : Math.round((rents[mid - 1] + rents[mid]) / 2);
}

/** True when every row is the property's own size, which is worth
 *  saying: a table of one-beds under a three-bed is weaker evidence
 *  and the heading should not pretend otherwise. */
export function allSameSize(
  comps: readonly LeaseComp[],
  bedrooms: number
): boolean {
  return comps.length > 0 && comps.every((c) => c.bedrooms === bedrooms);
}
