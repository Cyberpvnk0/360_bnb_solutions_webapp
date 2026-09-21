/**
 * Facts from Redfin's furnished search page, pinned to the Boston pageShape
 * probe on 2026-09-21. The page contains BOTH a normal rental search and a
 * building-consolidated search. Select one; concatenating them doubles rows.
 * Never copy descriptions, photos, contacts, or entire home objects out.
 */
import { atPath, decodeJsonValues, findJsonBlobs } from "./redfin-page-json";

type Row = Record<string, unknown>;

function object(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Row : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Normalize only the measured fields to the existing structured-row mapper. */
function rentalFacts(value: unknown): Row | null {
  const home = object(atPath(value, "homeData"));
  const rental = object(atPath(value, "rentalExtension"));
  const address = object(home?.addressInfo);
  if (!home || !rental || !address) return null;
  const street = text(address.formattedStreetLine);
  const url = text(home.url);
  const rent = number(atPath(rental, "rentPriceRange.min"));
  const beds = number(atPath(rental, "bedRange.min"));
  const lat = number(atPath(address, "centroid.centroid.latitude"));
  const lon = number(atPath(address, "centroid.centroid.longitude"));
  if (!street || !url || rent === undefined || rent <= 0 || beds === undefined || beds < 0
    || lat === undefined || Math.abs(lat) > 90 || lon === undefined || Math.abs(lon) > 180) return null;
  // Links are facts, but only links back to Redfin listing pages are useful.
  if (!URL.canParse(url, "https://www.redfin.com")) return null;
  const link = new URL(url, "https://www.redfin.com");
  if (link.origin !== "https://www.redfin.com" || link.username || link.password) return null;
  return {
    address: street,
    city: text(address.city),
    state: text(address.state),
    zip: text(address.zip),
    url: link.href,
    price: rent,
    beds,
    baths: number(atPath(rental, "bathRange.min")),
    sqFt: number(atPath(rental, "sqftRange.min")),
    latitude: lat,
    longitude: lon,
    // propertyType is a numeric vendor enum. Leave it unknown until its
    // meaning is measured; do not invent a translation to our type names.
  };
}

export interface RentalPageFacts {
  rows: Row[];
  morePages: boolean;
}

/** null means unreadable/unproven, NEVER an empty market. */
export function parseRedfinRentalPage(doc: string, searchUrl: string): RentalPageFacts | null {
  if (!URL.canParse(searchUrl)) return null;
  const requested = new URL(searchUrl);
  const city = /^\/city\/(\d+)\/[^/]+\/[^/]+\/(?:rentals|apartments-for-rent)\/filter\/is-furnished\/?$/
    .exec(requested.pathname)?.[1];
  if (requested.origin !== "https://www.redfin.com" || !city || requested.search) return null;

  const candidates: { rows: Row[]; morePages: boolean; consolidated: boolean }[] = [];
  for (const blob of findJsonBlobs(doc, 0)) {
    const cache = object(atPath(blob.value, '["ReactServerAgent.cache"].dataCache'));
    if (!cache) continue;
    for (const [key, entry] of Object.entries(cache)) {
      if (!key.startsWith("/stingray/api/v1/search/rentals?")) continue;
      const request = new URL(key, "https://www.redfin.com");
      if (request.pathname !== "/stingray/api/v1/search/rentals"
        || request.origin !== requested.origin
        || request.searchParams.get("is_furnished") !== "true"
        || request.searchParams.get("isRentals") !== "true"
        || request.searchParams.get("region_id") !== city
        || request.searchParams.get("region_type") !== "6") continue;
      const payload = object(decodeJsonValues(atPath(entry, "res.text")));
      const homes = payload?.homes;
      const count = number(payload?.numMatchedHomes);
      if (!Array.isArray(homes) || count === undefined || count < 0
        || !Number.isInteger(count) || (homes.length === 0) !== (count === 0)) continue;
      const rows = homes.map(rentalFacts).filter((row): row is Row => row !== null);
      if (homes.length > 0 && rows.length === 0) continue;
      // Rows carry stable listing links. Keep the first if the source repeats one.
      const unique = [...new Map(rows.map((row) => [row.url, row])).values()];
      candidates.push({
        rows: unique,
        morePages: count > homes.length,
        consolidated: request.searchParams.get("consolidateBuildings") === "true",
      });
    }
  }
  // Prefer individual listings; the consolidated response hides units in
  // building summaries. Both must independently prove the furnished filter.
  candidates.sort((a, b) => Number(a.consolidated) - Number(b.consolidated));
  const chosen = candidates[0];
  return chosen ? { rows: chosen.rows, morePages: chosen.morePages } : null;
}
