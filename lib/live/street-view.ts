/**
 * Google Street View of a listing's address — what the building looks
 * like from the kerb. Never the listing's own photos: this product
 * fetches, stores and shows none, and the type that carries a listing
 * cannot hold one. The chain a card walks is Street View, then an
 * aerial (lib/live/aerial), then the seeded sketch, each tagged for
 * what it is.
 *
 * Street View runs through our own route so the Google key stays on the
 * server and each address is fetched at most once a month. Google bills
 * per image request; the free metadata probe tells us whether imagery
 * exists before we ever pay for a picture, so blank spots cost nothing.
 */

const STREET_VIEW = "https://maps.googleapis.com/maps/api/streetview";

/**
 * Every spelling this key might have been saved under.
 *
 * Names are cheap; a silent miss because the variable was called
 * something reasonable-but-different costs an afternoon, and this
 * product has now lost one to exactly that twice — once to a Supabase
 * variable renamed in the dashboard, once here.
 */
const KEY_NAMES = [
  "GOOGLE_MAPS_API_KEY",
  "GOOGLE_MAPS_SECRET",
  "GOOGLE_MAPS_KEY",
  "GOOGLE_API_KEY",
] as const;

export function googleMapsKey(): string | null {
  for (const name of KEY_NAMES) {
    const value = process.env[name];
    if (value) return value;
  }
  return null;
}

/** Which GOOGLE_* names this deployment can see. Names only, never
 *  values — a diagnostic that prints a key is worse than the confusion
 *  it clears up. */
export function googleKeyNamesSeen(): string[] {
  return Object.keys(process.env)
    .filter((k) => /^GOOGLE/i.test(k))
    .sort();
}

/** Street View imagery rarely changes — cache hard. */
export const STREET_VIEW_REVALIDATE_SECONDS = 2_592_000; // 30 days

export function hasGoogleKey(): boolean {
  return googleMapsKey() !== null;
}

/**
 * What the free metadata endpoint says about a spot.
 *
 * Their statuses mean very different things and the first version of
 * this collapsed all of them into a boolean:
 *
 *   OK              imagery exists — go buy it
 *   ZERO_RESULTS    genuinely nothing here, and that is fine
 *   REQUEST_DENIED  the key, the enabled APIs, or the restrictions are
 *                   wrong. Nothing to do with this coordinate.
 *   OVER_QUERY_LIMIT  billing or quota
 *
 * A boolean turned the last two into "no photo at this address", so a
 * key with the API switched off rendered as a page of sketches and
 * looked like rural coverage. That is the whole failure mode of this
 * integration, and it was invisible.
 *
 * Free: the metadata endpoint is not billed, which is what lets every
 * blank spot cost nothing and lets a setup check be run at will.
 */
export interface StreetViewProbe {
  /** Imagery exists and is worth paying for. */
  ok: boolean;
  /** Their status string, or null when the call itself failed. */
  status: string | null;
  /** True when the problem is our configuration, not the coordinate. */
  denied: boolean;
  /** Google's own explanation. On REQUEST_DENIED this names the actual
   *  cause — API not enabled, referer restriction, billing — and it is
   *  the single most useful sentence in this whole integration. */
  detail: string | null;
  /** The panorama the metadata endpoint picked. The image is fetched by
   *  this id, not by coordinate, so the picture shown is the one that
   *  passed the checks below rather than whatever a second search
   *  happens to find. */
  panoId?: string | null;
  /** Who shot it. "© 2023 Google" is the car; anything else is a
   *  contribution. */
  copyright?: string | null;
  /** Metres between the address and the panorama. */
  metres?: number | null;
  /** Why a real panorama was turned down, when one was. */
  rejected?: string | null;
  /** Degrees clockwise from north, panorama → address. Null when the
   *  two are close enough that any bearing is noise. */
  heading?: number | null;
}

/**
 * How far from the address a panorama may stand and still be a picture
 * OF it. Google searches 50m by default; a shot from further than half
 * a block is the neighbour's house with this address underneath it.
 */
const MAX_PANO_METRES = 45;

/**
 * Whose camera took it.
 *
 * Google's own car imagery is stamped "© <year> Google". Everything
 * else — a shop's interior tour, somebody's photo sphere — carries the
 * contributor's name, and that is exactly the imagery that put a deli
 * counter and a clothing rail on two Minneapolis rentals. `source=
 * outdoor` is supposed to exclude indoor collections and demonstrably
 * does not catch all of them, so this is the check that actually
 * holds: we want the street, and the street is what the car drove.
 */
function shotByGoogle(copyright: string | null): boolean {
  return copyright !== null && /\bgoogle\b/i.test(copyright);
}

/**
 * Which way to point the camera: the bearing from the panorama to the
 * address, in degrees clockwise from north.
 *
 * Requesting by `location`, Google aims the camera at the location for
 * you. Requesting by `pano` there is no location to aim at, so it falls
 * back to the panorama's own orientation — the direction the car was
 * driving, which is down the street rather than at the house. Buying
 * the right panorama and then photographing the road is not an
 * improvement, so the aim is computed here, where both points are known.
 */
function bearingTo(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLon = rad(toLon - fromLon);
  const y = Math.sin(dLon) * Math.cos(rad(toLat));
  const x =
    Math.cos(rad(fromLat)) * Math.sin(rad(toLat)) -
    Math.sin(rad(fromLat)) * Math.cos(rad(toLat)) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/**
 * Below this, the panorama is effectively ON the address and a bearing
 * between the two points is noise rather than a direction. Let Google
 * choose in that case.
 */
const MIN_HEADING_METRES = 4;

/** Metres between two points. Haversine; the earth is round enough. */
function metresBetween(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/**
 * Answers worth remembering, and for how long.
 *
 * A REQUEST_DENIED is never one of them. It is a statement about OUR
 * configuration — an unlinked billing account, a disabled API, a
 * referrer restriction — and every one of those is something somebody
 * is actively in the middle of fixing. Google returns it as a normal
 * 200 with a JSON body, so a plain `revalidate` cache stores it happily
 * and keeps serving it long after the fix landed: you link billing, run
 * the check, and read back a refusal from days ago with no way to tell
 * it from a live one. That cost an afternoon, so denials are never
 * cached anywhere — not in the framework's data cache, not here.
 *
 * A real answer about a coordinate (OK, ZERO_RESULTS) does not change,
 * so it is memoised in this instance's memory. That keeps the round
 * trips down without any of them being able to outlive the truth.
 */
const PROBE_MEMO_MS = 6 * 60 * 60 * 1000;
const probeMemo = new Map<string, { at: number; probe: StreetViewProbe }>();

/** Empty the memo. For tests, which share one process and would
 *  otherwise read one case's answer in the next case's assertion. */
export function resetStreetViewProbeMemo(): void {
  probeMemo.clear();
}

/**
 * One look at one point. Transport problems come back as null; a real
 * answer from Google, however unwelcome, comes back described.
 */
interface PanoLook {
  status: string | null;
  errorMessage: string | null;
  copyright: string | null;
  panoId: string | null;
  lat: number | null;
  lon: number | null;
}

async function lookAt(
  lat: number,
  lon: number,
  key: string
): Promise<PanoLook | null> {
  const params = new URLSearchParams({
    location: `${lat},${lon}`,
    key,
    source: "outdoor",
    radius: String(MAX_PANO_METRES),
  });
  try {
    const res = await fetch(`${STREET_VIEW}/metadata?${params}`, {
      // Never `revalidate`: see the note above the memo.
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      status?: string;
      error_message?: string;
      copyright?: string;
      pano_id?: string;
      location?: { lat?: number; lng?: number };
    };
    return {
      status: body.status ?? null,
      errorMessage: body.error_message ?? null,
      copyright: body.copyright ?? null,
      panoId: body.pano_id ?? null,
      lat: typeof body.location?.lat === "number" ? body.location.lat : null,
      lon: typeof body.location?.lng === "number" ? body.location.lng : null,
    };
  } catch {
    return null;
  }
}

/**
 * Where else to look when the nearest panorama is not the car's.
 *
 * Google returns the CLOSEST panorama and offers no way to ask for its
 * own imagery — "there is no way to use only one source of Street View
 * imagery over the other", in their words. So a photo sphere somebody
 * shot on the pavement outranks the car that drove the same street,
 * and rejecting on that alone would throw away real coverage: the
 * setup check found exactly this at Times Square, of all places.
 *
 * The car drives roads, so a short hop in each direction lands on one.
 * Eight points at twenty-odd metres is a net wide enough to catch the
 * frontage whichever way the property faces, and every one of these is
 * the free metadata endpoint — the ring costs latency, not money.
 */
const RING_METRES = 22;
const RING: readonly (readonly [number, number])[] = Array.from(
  { length: 8 },
  (_, i) => {
    const a = (i * Math.PI) / 4;
    return [Math.cos(a), Math.sin(a)] as const;
  }
);

function ringAround(lat: number, lon: number): { lat: number; lon: number }[] {
  const dLat = RING_METRES / 111_320;
  const dLon = RING_METRES / (111_320 * Math.cos((lat * Math.PI) / 180) || 1);
  return RING.map(([ny, ex]) => ({
    lat: lat + ny * dLat,
    lon: lon + ex * dLon,
  }));
}

export async function streetViewProbe(
  lat: number,
  lon: number
): Promise<StreetViewProbe> {
  const key = googleMapsKey();
  if (!key) {
    return { ok: false, status: null, denied: true, detail: "no key configured" };
  }
  // Keyed by the coordinate AND the key, so swapping the key re-asks
  // rather than replaying what the old one was told.
  const memoKey = `${lat},${lon}|${key.slice(-8)}`;
  const hit = probeMemo.get(memoKey);
  if (hit && Date.now() - hit.at < PROBE_MEMO_MS) return hit.probe;

  const centre = await lookAt(lat, lon, key);
  if (!centre) {
    return { ok: false, status: null, denied: false, detail: "network or timeout" };
  }

  const denied =
    centre.status === "REQUEST_DENIED" || centre.status === "OVER_QUERY_LIMIT";
  const base = {
    status: centre.status,
    denied,
    detail: centre.errorMessage,
  };

  if (centre.status !== "OK") {
    const probe: StreetViewProbe = { ok: false, ...base };
    if (!denied) probeMemo.set(memoKey, { at: Date.now(), probe });
    return probe;
  }

  /**
   * A panorama exists — but is it the car's, and is it of THIS
   * building? Turning one down costs a card its kerb shot and it falls
   * to an aerial, which says "no photo" honestly. Showing the wrong one
   * puts a stranger's shopfront under somebody's address and reads as
   * fact. So both checks fail closed, and the ring is what keeps that
   * from costing more coverage than it has to.
   */
  const distance = (l: PanoLook | null) =>
    l && l.lat !== null && l.lon !== null
      ? metresBetween(lat, lon, l.lat, l.lon)
      : null;

  const usable = (l: PanoLook | null) =>
    l !== null &&
    l.status === "OK" &&
    shotByGoogle(l.copyright) &&
    (distance(l) ?? Infinity) <= MAX_PANO_METRES;

  let best: PanoLook | null = usable(centre) ? centre : null;
  if (!best) {
    const ring = await Promise.all(
      ringAround(lat, lon).map((p) => lookAt(p.lat, p.lon, key))
    );
    for (const found of ring) {
      if (!usable(found)) continue;
      if (best === null || (distance(found) ?? 0) < (distance(best) ?? 0)) {
        best = found;
      }
    }
  }

  const away = distance(best);
  const probe: StreetViewProbe = best
    ? {
        ok: true,
        ...base,
        panoId: best.panoId,
        copyright: best.copyright,
        metres: away,
        rejected: null,
        heading:
          best.lat !== null &&
          best.lon !== null &&
          (away ?? 0) >= MIN_HEADING_METRES
            ? Math.round(bearingTo(best.lat, best.lon, lat, lon))
            : null,
      }
    : {
        ok: false,
        ...base,
        panoId: centre.panoId,
        copyright: centre.copyright,
        metres: distance(centre),
        rejected: shotByGoogle(centre.copyright)
          ? `nearest Street View panorama is ${distance(centre)}m away`
          : `only contributed imagery here (${centre.copyright ?? "no copyright"}), and no Street View car panorama within ${MAX_PANO_METRES}m`,
      };

  // Only a fact about the coordinate is worth keeping.
  if (!denied) probeMemo.set(memoKey, { at: Date.now(), probe });
  return probe;
}

/**
 * The SAME key against the OTHER API this product uses.
 *
 * The two failures look identical from one endpoint and need opposite
 * fixes. If Geocoding is refused too, the problem belongs to the whole
 * project — its billing link, or the key itself. If Geocoding answers
 * and Street View does not, billing is fine and the Street View Static
 * API simply is not switched on for that project. Asking one endpoint
 * and guessing between those two is how an afternoon goes.
 *
 * Geocoding bills per request, but one call to settle which of two
 * fixes to make is the cheapest request this product will ever send.
 */
export async function geocodingProbe(): Promise<StreetViewProbe> {
  const key = googleMapsKey();
  if (!key) {
    return { ok: false, status: null, denied: true, detail: "no key configured" };
  }
  const params = new URLSearchParams({
    address: "1600 Amphitheatre Parkway, Mountain View, CA",
    key,
  });
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${params}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      return {
        ok: false,
        status: null,
        denied: false,
        detail: `geocode HTTP ${res.status}`,
      };
    }
    const body = (await res.json()) as {
      status?: string;
      error_message?: string;
    };
    const status = body.status ?? null;
    return {
      ok: status === "OK",
      status,
      denied: status === "REQUEST_DENIED" || status === "OVER_QUERY_LIMIT",
      detail: body.error_message ?? null,
    };
  } catch {
    return { ok: false, status: null, denied: false, detail: "network or timeout" };
  }
}

/** Does Street View have this spot? Kept for callers that only need
 *  the yes/no and have no way to act on the difference. */
export async function streetViewExists(
  lat: number,
  lon: number
): Promise<boolean> {
  return (await streetViewProbe(lat, lon)).ok;
}

/**
 * The billed image request — only ever made after the probe says OK.
 *
 * By panorama id when the probe found one, because the probe is where
 * the judging happens: asking again by coordinate is a second search
 * that can land on a different panorama, and then we have vetted one
 * picture and rendered another.
 */
export async function fetchStreetView(
  lat: number,
  lon: number,
  panoId?: string | null,
  heading?: number | null
): Promise<ArrayBuffer | null> {
  const key = googleMapsKey();
  if (!key) return null;
  const params = new URLSearchParams({
    ...(panoId
      ? { pano: panoId }
      : {
          location: `${lat},${lon}`,
          source: "outdoor",
          radius: String(MAX_PANO_METRES),
        }),
    // See bearingTo: by pano id there is no location for Google to aim
    // at, so an unaimed request photographs the road.
    ...(typeof heading === "number" ? { heading: String(heading) } : {}),
    size: "640x360",
    fov: "80",
    return_error_code: "true",
    key,
  });
  try {
    const res = await fetch(`${STREET_VIEW}?${params}`, {
      next: { revalidate: STREET_VIEW_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}
