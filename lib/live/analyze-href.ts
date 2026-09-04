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
 */
export function analyzeHref(l: {
  address: string;
  city?: string;
  stateCode?: string;
  lat: number;
  lon: number;
  bedrooms: number;
  bathrooms: number;
  propertyType: string;
  /** Asking rent per month. Absent for a row that has none. */
  rentMonthly?: number;
}): string {
  const params = new URLSearchParams({
    a: l.address,
    lat: String(l.lat),
    lon: String(l.lon),
    bd: String(l.bedrooms),
    ba: String(l.bathrooms),
    t: l.propertyType,
  });
  if (Number.isFinite(l.rentMonthly) && (l.rentMonthly as number) > 0) {
    params.set("r", String(Math.round(l.rentMonthly as number)));
  }
  // The unit's own city, not the market's name. A listing in a suburb
  // the market covers is not IN the market's namesake city, and the
  // header printing one under the other's address reads as a mismatch
  // against the card it came from.
  if (l.city?.trim()) params.set("c", l.city.trim());
  if (l.stateCode?.trim()) params.set("s", l.stateCode.trim());
  return `/analyze/new?${params}`;
}
