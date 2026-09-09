/**
 * Straight to the numbers.
 *
 * A listing already carries its address, its coordinates, its size and
 * — the point of the whole exercise — WHAT IT COSTS TO LEASE. Routing
 * through the entry form asked a person to re-enter things the app had
 * in hand and then press a second button. The parameters go directly to
 * the result; everything stays correctable there if the feed had it
 * wrong.
 *
 * THE RENT IS NOT OPTIONAL DECORATION. It used to be left out, so the
 * analyzer fell back to a median of comparable leases — an estimate of
 * what a place like this rents for, standing in for what THIS one
 * actually asks. Every figure on the result is computed off that
 * number, so a card reading $2,150 opened a calculator reading $1,830
 * and a different cushion, in the one field somebody came to the page
 * to reason about. It travels in the URL now, with the rest.
 *
 * SO DOES THE LISTING'S OWN PAGE. The result's "View photos" opens the
 * listing when it holds that page and searches for the address when it
 * does not — and the analyzer cannot find the page for itself, because
 * no portal resolves a street address to a listing. Left out of the
 * URL, every property that arrived from a card with a direct link
 * opened a result that could only search for it.
 */
import { usableListingPage } from "./listing-links";

export function analyzeHref(l: {
  address: string;
  city?: string;
  stateCode?: string;
  lat: number;
  lon: number;
  bedrooms: number;
  bathrooms: number;
  propertyType: string;
  /** False when the type above is a filtering stand-in, not a fact. */
  propertyTypeKnown?: boolean;
  /** Asking rent per month. Absent for a row that has none. */
  rentMonthly?: number;
  /** The listing's own page at its source, when the feed gave one. */
  sourceUrl?: string;
}): string {
  const params = new URLSearchParams({
    a: l.address,
    lat: String(l.lat),
    lon: String(l.lon),
    bd: String(l.bedrooms),
    ba: String(l.bathrooms),
  });
  // The type travels only when the listing stated it. A stand-in used
  // for filtering would arrive on the result as a fact about the house.
  if (l.propertyTypeKnown !== false) params.set("t", l.propertyType);
  if (Number.isFinite(l.rentMonthly) && (l.rentMonthly as number) > 0) {
    params.set("r", String(Math.round(l.rentMonthly as number)));
  }
  // The unit's own city, not the market's name. A listing in a suburb
  // the market covers is not IN the market's namesake city, and the
  // header printing one under the other's address reads as a mismatch
  // against the card it came from.
  if (l.city?.trim()) params.set("c", l.city.trim());
  if (l.stateCode?.trim()) params.set("s", l.stateCode.trim());
  // Only a page the link itself would open: https, on the listing site.
  // A feed's URL field is not a navigation target on trust, here or
  // anywhere else.
  const page = usableListingPage(l.sourceUrl);
  if (page) params.set("u", page);
  return `/analyze/new?${params}`;
}
