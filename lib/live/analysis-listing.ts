/**
 * The listing a result stands for, for the account's lists.
 *
 * "Add to list" files a RentalListing. The Deal Finder has one in
 * hand; the result page has an Analysis, which is the same property
 * one step on. This walks the step back, so a property can be
 * shortlisted from the page that priced it as well as from the card,
 * and lands in the same list row either way.
 *
 * THE SAME ROW. What makes a shortlist entry the card's is its id: the
 * menu, the lists tab and the store all match on it. A listing handed
 * over from the Deal Finder sends its id along in the URL
 * (lib/live/analyze-href, `l`), so the result keeps it. A live row's
 * analysis carries the listing's id inside its own — `r--live--…` is
 * the analysis of `live--…`. A typed address gets one minted from its
 * analysis id, which is stable for the same address and shape, so
 * adding it twice is the same row and not a second.
 *
 * What the analysis does not know it does not invent: no size in
 * square feet, no listing date, no amenities — `featuresKnown` false
 * says so — and no contact. The rent is the one the calculator opened
 * on: the listing's asking rent when it had one, the comp median when
 * nobody did.
 */

import type { Analysis, RentalListing } from "@/lib/mock/types";

const LIVE_ANALYSIS = "r--live--";

/** The listing id an analysis stands for, when none was handed over. */
export function listingIdForAnalysis(analysisId: string): string {
  return analysisId.startsWith(LIVE_ANALYSIS) ? analysisId.slice("r--".length) : `rl--${analysisId}`;
}

export function listingForAnalysis(
  analysis: Analysis,
  opts: {
    /** The Deal Finder listing this came from, when the URL carried it. */
    listingId?: string | null;
    /** The property's own coordinates when known, the market's centre
     *  otherwise. Without either there is no row to file. */
    point: { lat: number; lon: number } | null;
    /** False when the type was assumed rather than stated. */
    typeKnown?: boolean;
  }
): RentalListing | null {
  if (!opts.point) return null;
  const handed = opts.listingId?.trim();
  return {
    id: handed || listingIdForAnalysis(analysis.id),
    analysisId: analysis.id,
    address: analysis.address,
    city: analysis.city,
    stateCode: analysis.stateCode,
    ...(analysis.zip ? { zip: analysis.zip } : {}),
    marketSlug: analysis.marketSlug,
    lat: opts.point.lat,
    lon: opts.point.lon,
    bedrooms: analysis.bedrooms,
    bathrooms: analysis.bathrooms,
    sqft: 0,
    propertyType: analysis.propertyType,
    ...(opts.typeKnown === false ? { propertyTypeKnown: false } : {}),
    rentMonthly: Math.round(analysis.defaults.monthlyRent),
    petFriendly: false,
    ...(analysis.sourceUrl ? { sourceUrl: analysis.sourceUrl } : {}),
    features: [],
    featuresKnown: false,
  };
}
