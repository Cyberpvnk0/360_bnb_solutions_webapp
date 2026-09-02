/**
 * An overhead photo of a property, when there is no curb photo.
 *
 * Third in a chain, and it exists because the first two can each be
 * absent for reasons that have nothing to do with the property:
 *
 *   1. the listing's own photo — furnished rentals only, where the
 *      source ships one
 *   2. Street View — the best picture of a building, and unavailable
 *      whenever the Google key isn't working
 *   3. this — an aerial of the exact coordinate, nationwide, no
 *      coverage gaps, free to fifty thousand a month
 *
 * An aerial is a weaker picture than a kerb shot: a roof and a
 * driveway, not a front elevation. It is a real photograph of the real
 * address though, which beats a sketch, and it never misses — there is
 * no aerial equivalent of a street a car never drove down.
 *
 * CENTRED, which is the whole reason this provider and not the one
 * already wired for the basemap. A raw map tile is not centred on
 * anything in particular, so a house near a tile edge shows you the
 * neighbour's roof; their static endpoint takes a coordinate. The other
 * provider charges for that and this one does not.
 */

const STATIC = "https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static";

/** Aerial imagery is re-flown every few years. Cache for a month, like
 *  its sibling — the bill tracks distinct addresses, not pageviews. */
export const AERIAL_REVALIDATE_SECONDS = 2_592_000;

/**
 * Close enough to fill the frame with one property and its lot.
 *
 * 18 puts a typical suburban parcel across most of a 640px frame. 19
 * crops into the roof and loses the driveway and the street, which are
 * the two things that tell somebody what they are looking at.
 */
const ZOOM = 18;
const SIZE = "640x360";

const TOKEN_NAMES = [
  "MAPBOX_TOKEN",
  "MAPBOX_ACCESS_TOKEN",
  "MAPBOX_KEY",
  "NEXT_PUBLIC_MAPBOX_TOKEN",
] as const;

export function mapboxToken(): string | null {
  for (const name of TOKEN_NAMES) {
    const value = process.env[name];
    if (value) return value;
  }
  return null;
}

export function hasAerialKey(): boolean {
  return mapboxToken() !== null;
}

/** Which MAPBOX_* names this deployment can see. Names only, never
 *  values — a diagnostic that prints a key is worse than the confusion
 *  it clears up. */
export function aerialKeyNamesSeen(): string[] {
  return Object.keys(process.env)
    .filter((k) => /MAPBOX/i.test(k))
    .sort();
}

/**
 * Their static endpoint, for one coordinate.
 *
 * Longitude BEFORE latitude, which is their order and the opposite of
 * how every other call in this codebase writes a point. Getting it
 * backwards puts Florida in the Indian Ocean and returns a photograph
 * of open water, which looks like a working integration.
 */
export function aerialUrl(lat: number, lon: number, token: string): string {
  return `${STATIC}/${lon},${lat},${ZOOM},0/${SIZE}@2x?access_token=${encodeURIComponent(token)}`;
}

/** The image bytes, or null. Never throws: a missing picture must not
 *  fail a card that is otherwise fine. */
export async function fetchAerial(
  lat: number,
  lon: number
): Promise<ArrayBuffer | null> {
  const token = mapboxToken();
  if (!token) return null;
  try {
    const res = await fetch(aerialUrl(lat, lon, token), {
      next: { revalidate: AERIAL_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}
