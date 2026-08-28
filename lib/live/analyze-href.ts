/**
 * Straight to the numbers.
 *
 * A listing already carries its address, its coordinates and its size,
 * so routing through the entry form asked a person to re-enter three
 * things the app had in hand and then press a second button. The
 * parameters go directly to the result; the size stays correctable
 * there if the feed had it wrong.
 */
export function analyzeHref(l: {
  address: string;
  lat: number;
  lon: number;
  bedrooms: number;
  bathrooms: number;
  propertyType: string;
}): string {
  const params = new URLSearchParams({
    a: l.address,
    lat: String(l.lat),
    lon: String(l.lon),
    bd: String(l.bedrooms),
    ba: String(l.bathrooms),
    t: l.propertyType,
  });
  return `/analyze/new?${params}`;
}
