/**
 * Address → coordinates.
 *
 * Redfin's search rows carry no latitude or longitude, and the Deal
 * Finder is a map. The tempting shortcut — drop every pin at the city
 * centre, or scatter them around it — would put a marker on a street
 * the property isn't on, which is a lie a student would drive to. So a
 * listing we can't place is a listing we don't show, and this exists to
 * keep that set small.
 *
 * Primary source is the US Census geocoder: free, keyless, public, and
 * scoped to exactly the country this product covers. Google Geocoding
 * is used only as a fallback and only when a key is already configured.
 * Results cache for 30 days — a building doesn't move.
 */

const CENSUS =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const GOOGLE = "https://maps.googleapis.com/maps/api/geocode/json";

/** A street address doesn't move; cache hard. */
export const GEOCODE_REVALIDATE_SECONDS = 2_592_000;

export interface Point {
  lat: number;
  lon: number;
}

/** Where a coordinate came from — surfaced in diagnostics so a poor
 *  hit rate can be attributed to the right service. */
export type GeocodeSource = "census" | "google";

export interface GeocodeResult {
  point: Point | null;
  source: GeocodeSource | null;
  /** Why nothing came back, when nothing did. */
  failure: string | null;
}

function usable(lat: unknown, lon: unknown): Point | null {
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // A zero pair is the classic "geocoder gave up" answer, and it plots
  // in the Gulf of Guinea rather than anywhere in the US.
  if (lat === 0 && lon === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

async function viaCensus(address: string): Promise<Point | null> {
  const params = new URLSearchParams({
    address,
    benchmark: "Public_AR_Current",
    format: "json",
  });
  const res = await fetch(`${CENSUS}?${params}`, {
    next: { revalidate: GEOCODE_REVALIDATE_SECONDS },
  });
  if (!res.ok) return null;
  const body: unknown = await res.json().catch(() => null);
  const matches = (
    body as { result?: { addressMatches?: { coordinates?: Record<string, unknown> }[] } }
  )?.result?.addressMatches;
  const first = Array.isArray(matches) ? matches[0] : undefined;
  // Census names them x/y — longitude first, which is the classic way
  // to end up with a map of the Indian Ocean.
  return usable(first?.coordinates?.y, first?.coordinates?.x);
}

async function viaGoogle(address: string): Promise<Point | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const params = new URLSearchParams({ address, key, region: "us" });
  const res = await fetch(`${GOOGLE}?${params}`, {
    next: { revalidate: GEOCODE_REVALIDATE_SECONDS },
  });
  if (!res.ok) return null;
  const body: unknown = await res.json().catch(() => null);
  const loc = (
    body as { results?: { geometry?: { location?: Record<string, unknown> } }[] }
  )?.results?.[0]?.geometry?.location;
  return usable(loc?.lat, loc?.lng);
}

/**
 * One address → one point, or an honest null.
 *
 * Never throws: a listing that can't be placed is dropped by the
 * caller, and one unreachable geocoder must not take a whole market's
 * results down with it.
 */
export async function geocode(address: string): Promise<GeocodeResult> {
  const query = address.trim();
  if (!query) return { point: null, source: null, failure: "empty-address" };

  try {
    const census = await viaCensus(query);
    if (census) return { point: census, source: "census", failure: null };
  } catch {
    // Fall through to the paid fallback rather than fail the row.
  }

  try {
    const google = await viaGoogle(query);
    if (google) return { point: google, source: "google", failure: null };
  } catch {
    return { point: null, source: null, failure: "network" };
  }

  return { point: null, source: null, failure: "no-match" };
}

/** Geocode many addresses, a few at a time. Order is preserved. */
export async function geocodeAll(
  addresses: readonly string[],
  concurrency = 6
): Promise<GeocodeResult[]> {
  const out: GeocodeResult[] = new Array(addresses.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, addresses.length) },
    async () => {
      for (;;) {
        const i = next++;
        if (i >= addresses.length) return;
        out[i] = await geocode(addresses[i]);
      }
    }
  );
  await Promise.all(runners);
  return out;
}
