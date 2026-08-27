/**
 * AirROI — the live short-term-rental data behind projections.
 *
 * Server-side ONLY: the key lives in AIRROI_API_KEY and every call goes
 * through app/api/str, never the browser. AirROI bills per call, so
 * responses cache hard (comps for a day, market analytics for a week —
 * a market's trailing-12 ADR doesn't move hourly) and the same daily cap
 * that guards the rental feed guards this one.
 *
 * Endpoint paths are the vendor's real ones, taken from their published
 * examples: no version prefix, `x-api-key` for auth, coordinates as
 * `latitude`/`longitude` on listings and `lat`/`lng` on markets. An
 * earlier draft of this file invented a `/v1/` prefix and would have
 * 404'd on the first real call.
 *
 * FIELD NAMES ARE OBSERVED, not guessed. A comp arrives as eight nested
 * objects and the figures live inside them: rate and occupancy under
 * performance_metrics, size under property_details, position under
 * location_info. An earlier version read flat top-level keys, which
 * would have mapped all twenty-five rows to null, tripped the
 * too-thin-to-underwrite guard, and shown seeded comps with no error
 * anywhere — live data arriving and being thrown away in silence.
 *
 * The flat readers are kept as a fallback so a reshaped payload
 * degrades instead of vanishing.
 *
 * ON PROSE: listing_info.description is somebody's marketing paragraph
 * and it stops here. StrComp has nowhere to put it, nothing returns the
 * raw payload, and that is deliberate — the same rule the enrichment
 * module is built around.
 *
 * Billing is per call, between $0.01 and $1.00 depending on endpoint,
 * which is the whole reason the revalidate windows below are long.
 */

import type { StrComp } from "@/lib/mock/types";

const BASE = "https://api.airroi.com";

/** Comparable listings around a point — the comps behind a projection. */
export const COMPS_PATH = "/listings/comparables";
/**
 * A coordinate's market — IDENTITY ONLY.
 *
 * Measured, not assumed: this returns full_name, country, region,
 * locality and district, and no performance figures whatsoever. The
 * first version of this file treated it as the analytics call and would
 * have mapped a market with no ADR and no occupancy to null forever,
 * looking for all the world like a market with no data.
 */
export const MARKET_PATH = "/markets/lookup";

/** Where the market's actual numbers live, keyed by the full_name that
 *  lookup hands back. */
export const MARKET_METRICS_PATH = "/markets/metrics/all";

/** Comps move with new bookings; market aggregates barely move at all. */
export const COMPS_REVALIDATE_SECONDS = 86_400; // 1 day
export const MARKET_REVALIDATE_SECONDS = 604_800; // 7 days

export class AirRoiError extends Error {
  constructor(
    readonly reason: "no-key" | "auth" | "quota" | "http" | "network",
    readonly status?: number,
    /** What the service said went wrong. A rejected request explains
     *  itself in the body, and the first version of this class dropped
     *  that on the floor — which turned a 400 that names its missing
     *  parameter into a silent "http". */
    readonly detail?: string
  ) {
    super(`AirROI ${reason}${status ? ` (${status})` : ""}`);
    this.name = "AirRoiError";
  }
}

export function hasAirRoiKey(): boolean {
  return Boolean(process.env.AIRROI_API_KEY);
}

/* ------------------------------------------------------------------ */
/* Tolerant field readers                                              */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

/** First key that holds a finite number, whatever the vendor calls it. */
function pickNumber(row: Row, keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v.replace(/[$,%,\s]/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function pickString(row: Row, keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

/** Occupancy arrives as either 0–1 or 0–100 depending on the endpoint;
 *  this product stores fractions, always. */
export function toFraction(value: number | null): number | null {
  if (value === null) return null;
  const f = value > 1.5 ? value / 100 : value;
  return f >= 0 && f <= 1 ? f : null;
}

// Trailing twelve months first — a year absorbs a season, ninety days
// does not, and a projection built on a summer is a projection that
// fails every winter.
const ADR_KEYS = ["ttm_avg_rate", "adr", "avg_daily_rate", "averageDailyRate", "average_daily_rate", "avgDailyRate", "nightlyRate", "price"];
const OCC_KEYS = ["ttm_occupancy", "occupancy", "avg_occupancy", "occupancyRate", "occupancy_rate", "occ"];
const REV_KEYS = ["ttm_revenue", "annualRevenue", "annual_revenue", "revenueLtm", "revenue_ltm", "revenue"];
// bedrooms before beds: their payload carries both and they differ —
// a studio with two beds is not a two-bedroom.
const BEDS_KEYS = ["bedrooms", "bedroomCount", "beds"];
const BATHS_KEYS = ["baths", "bathrooms", "bathroomCount"];
const DIST_KEYS = ["distanceMiles", "distance_miles", "distance"];
const NAME_KEYS = ["listing_name", "title", "name", "listingName", "listing_title"];
const ID_KEYS = ["listing_id", "id", "listingId", "airbnbId"];
const LAT_KEYS = ["latitude", "lat"];
const LON_KEYS = ["longitude", "lng", "lon", "long"];

/**
 * One AirROI listing → the StrComp shape the projection already runs on.
 * Returns null for a row missing anything load-bearing: a comp without a
 * rate or an occupancy can't back a revenue estimate, and a fabricated
 * one would quietly poison every number downstream.
 */
export function mapComp(raw: unknown, index: number): StrComp | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Row;

  const adr = nestedNumber(row, "performance_metrics", ADR_KEYS, ADR_KEYS);
  /**
   * Unadjusted, deliberately.
   *
   * They publish both: ttm_occupancy is reserved nights over all 365,
   * ttm_adjusted_occupancy is reserved over the nights the host chose
   * to make available. A host who blocks half the year looks fully
   * booked on the adjusted figure. A student underwriting a lease will
   * have all 365 nights to fill, so the unadjusted number is the one
   * that answers their question, and it is the conservative one — which
   * is the right way to be wrong about somebody's rent.
   */
  const occupancy = toFraction(
    nestedNumber(row, "performance_metrics", OCC_KEYS, OCC_KEYS)
  );
  if (adr === null || adr <= 0 || occupancy === null) return null;

  const bedrooms = nestedNumber(row, "property_details", BEDS_KEYS, BEDS_KEYS) ?? 0;
  const bathrooms = nestedNumber(row, "property_details", BATHS_KEYS, BATHS_KEYS) ?? 1;
  const distance = pickNumber(row, DIST_KEYS);

  const info = group(row, "listing_info");
  const id =
    (info ? pickString(info, ID_KEYS) ?? pickNumber(info, ID_KEYS)?.toString() : null) ??
    pickString(row, ID_KEYS) ??
    `airroi-${index}`;
  const name =
    (info ? pickString(info, NAME_KEYS) : null) ?? pickString(row, NAME_KEYS);

  // Only a pair counts. Half a coordinate would place a pin on the
  // prime meridian and look deliberate doing it.
  const lat = nestedNumber(row, "location_info", LAT_KEYS, LAT_KEYS);
  const lon = nestedNumber(row, "location_info", LON_KEYS, LON_KEYS);
  /**
   * The host's listing is only pinned where the feed says it is when the
   * feed says that position is exact. Airbnb fuzzes a listing's location
   * until it is booked, and the payload admits which is which — so a
   * fuzzed coordinate is treated as no coordinate rather than drawn as
   * a precise one.
   */
  const exact = group(row, "location_info")?.exact_location;
  const usable =
    lat !== null && lon !== null &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180 &&
    exact !== false;
  const placed = usable ? { lat: lat!, lon: lon! } : {};

  const revenue = nestedNumber(row, "performance_metrics", REV_KEYS, REV_KEYS);

  return {
    id: `sc-live-${id}`,
    name: name ?? `${Math.max(1, Math.round(bedrooms))} BR nearby rental`,
    bedrooms: Math.max(0, Math.round(bedrooms)),
    bathrooms: Math.max(0.5, bathrooms),
    adr: Math.round(adr),
    // Whole-point storage, like every other occupancy in the product.
    occupancy: Math.round(occupancy * 100) / 100,
    distanceMiles: distance === null ? 0 : Math.round(distance * 10) / 10,
    ...placed,
    ...(revenue !== null && revenue > 0 ? { annualRevenue: Math.round(revenue) } : {}),
  };
}

export interface MarketAnalytics {
  adr: number;
  /** Fraction, whole-point precision. */
  occupancy: number;
  annualRevenue: number | null;
  activeListings: number | null;
}

export function mapMarketAnalytics(raw: unknown): MarketAnalytics | null {
  if (!raw || typeof raw !== "object") return null;
  // Payloads often nest the figures one level down.
  const outer = raw as Row;
  const row = (outer.data ?? outer.metrics ?? outer.market ?? outer) as Row;

  const adr = pickNumber(row, ADR_KEYS);
  const occupancy = toFraction(pickNumber(row, OCC_KEYS));
  if (adr === null || adr <= 0 || occupancy === null) return null;

  return {
    adr: Math.round(adr),
    occupancy: Math.round(occupancy * 100) / 100,
    annualRevenue: pickNumber(row, REV_KEYS),
    activeListings: pickNumber(row, ["active_listings", "activeListings", "listingCount", "supply"]),
  };
}

/** One nested object, or null. Their comps put every real figure one
 *  level down, so this is the workhorse. */
function group(row: Row, key: string): Row | null {
  const v = row[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null;
}

/** Read a number from a nested group first, then from the top level —
 *  so a reshaped payload degrades to the old behaviour rather than to
 *  nothing. */
function nestedNumber(row: Row, groupKey: string, keys: string[], flat: string[]): number | null {
  const g = group(row, groupKey);
  return (g ? pickNumber(g, keys) : null) ?? pickNumber(row, flat);
}

/** Arrays hide under different keys per endpoint; find the first one. */
export function extractArray(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  for (const key of ["data", "results", "listings", "comps", "items"]) {
    const v = (body as Row)[key];
    if (Array.isArray(v)) return v;
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

async function call(
  path: string,
  params: Record<string, string>,
  revalidate: number
): Promise<unknown> {
  const key = process.env.AIRROI_API_KEY;
  if (!key) throw new AirRoiError("no-key");

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, {
      headers: {
        // Their documented scheme, singular. An earlier version also
        // sent a Bearer token on the guess that one of the two would
        // land; the docs settle it, and a stray credential header is
        // not a free thing to send.
        "x-api-key": key,
        Accept: "application/json",
      },
      next: { revalidate },
    });
  } catch {
    throw new AirRoiError("network");
  }

  if (!res.ok) {
    // Validation prose, not listing data — safe to surface and the
    // whole point of asking.
    const detail = (await res.text().catch(() => ""))
      .replace(/\s+/g, " ")
      .slice(0, 300);
    if (res.status === 401 || res.status === 403) {
      throw new AirRoiError("auth", res.status, detail);
    }
    if (res.status === 402 || res.status === 429) {
      throw new AirRoiError("quota", res.status, detail);
    }
    throw new AirRoiError("http", res.status, detail);
  }
  return res.json().catch(() => null);
}

const EARTH_RADIUS_MILES = 3958.8;

/**
 * Great-circle miles between two points.
 *
 * Their comps carry no distance field — reasonably, since distance is
 * only meaningful relative to whatever you asked about — so it is
 * computed here from the coordinates they do give. Flat-earth
 * arithmetic would be close enough at three miles and wrong in a way
 * that grows silently with radius.
 */
function milesBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Nearby active short-term rentals, closest first. */
export async function fetchComps(opts: {
  lat: number;
  lon: number;
  bedrooms?: number;
  baths?: number;
  guests?: number;
  limit?: number;
}): Promise<StrComp[]> {
  const body = await call(
    COMPS_PATH,
    {
      latitude: String(opts.lat),
      longitude: String(opts.lon),
      ...(opts.bedrooms ? { bedrooms: String(opts.bedrooms) } : {}),
      ...(opts.baths ? { baths: opts.baths.toFixed(1) } : {}),
      ...(opts.guests ? { guests: String(opts.guests) } : {}),
      // Prices in the listing's own currency; these are US markets, so
      // this keeps them dollars rather than a converted figure.
      currency: "native",
    },
    COMPS_REVALIDATE_SECONDS
  );
  const subject = { lat: opts.lat, lon: opts.lon };
  return extractArray(body)
    .map(mapComp)
    .filter((c): c is StrComp => c !== null)
    .map((c) =>
      c.distanceMiles > 0 || c.lat === undefined || c.lon === undefined
        ? c
        : {
            ...c,
            distanceMiles:
              Math.round(milesBetween(subject, { lat: c.lat, lon: c.lon }) * 10) / 10,
          }
    )
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, opts.limit ?? 12);
}

/** Trailing-twelve ADR, occupancy and supply for a point. */
export async function fetchMarketAnalytics(opts: {
  lat: number;
  lon: number;
}): Promise<MarketAnalytics | null> {
  // Markets take lat/lng, not latitude/longitude — the two families of
  // endpoint genuinely differ, which is exactly the kind of thing that
  // only shows up against the real service.
  const body = await call(
    MARKET_PATH,
    { lat: String(opts.lat), lng: String(opts.lon) },
    MARKET_REVALIDATE_SECONDS
  );
  return mapMarketAnalytics(body);
}

/** Raw payload for one call — the diagnostic that lets us pin the field
 *  names to reality the first time a real key is present. */
export async function probeShape(
  path: string,
  params: Record<string, string>
): Promise<unknown> {
  return call(path, params, 60);
}

/**
 * Candidate endpoints, for the discovery sweep.
 *
 * Their documented examples name these paths, but "documented" and
 * "what this key can reach" are different claims, and neither the docs
 * nor the service are reachable from where this was written. So the
 * sweep asks the service itself and reports what each one said.
 *
 * Every row costs a call — a cent to a dollar each, per their pricing
 * — which is why this is a deliberate diagnostic and not something a
 * page ever triggers.
 */
export const PROBE_TARGETS: { path: string; params: (lat: number, lon: number) => Record<string, string> }[] = [
  // Their example sends baths and guests as well; the first sweep sent
  // neither and got a 400 for it.
  {
    path: COMPS_PATH,
    params: (lat, lon) => ({
      latitude: String(lat),
      longitude: String(lon),
      bedrooms: "2",
      baths: "2.0",
      guests: "4",
      currency: "native",
    }),
  },
  { path: MARKET_PATH, params: (lat, lon) => ({ lat: String(lat), lng: String(lon) }) },
];

/**
 * Stage two: endpoints that need a market identifier, tried with the
 * one stage one actually returned rather than a guess at its format.
 */
export const MARKET_PROBE_TARGETS: { path: string; params: (fullName: string) => Record<string, string> }[] = [
  { path: MARKET_METRICS_PATH, params: (n) => ({ full_name: n, currency: "native" }) },
  { path: MARKET_METRICS_PATH, params: (n) => ({ market: n, currency: "native" }) },
  { path: "/markets/metrics/occupancy", params: (n) => ({ full_name: n }) },
];

/** The market identifier a lookup response carries, if it carries one. */
export function fullNameOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Row;
  const direct = pickString(row, ["full_name", "fullName"]);
  if (direct) return direct;
  // Search responses wrap their rows.
  const entries = (row.entries ?? row.data ?? row.results) as unknown;
  if (Array.isArray(entries) && entries[0] && typeof entries[0] === "object") {
    return pickString(entries[0] as Row, ["full_name", "fullName"]);
  }
  return null;
}

export interface ProbeOutcome {
  path: string;
  ok: boolean;
  status: number | null;
  reason: string | null;
  /** What the service said, when it refused. */
  detail: string | null;
}

/** One candidate, reporting rather than throwing — a 404 is the answer
 *  the sweep is looking for, not a failure of the sweep. */
export async function probeEndpoint(
  path: string,
  params: Record<string, string>
): Promise<ProbeOutcome & { shape: unknown }> {
  try {
    const body = await call(path, params, 60);
    return { path, ok: true, status: 200, reason: null, detail: null, shape: body };
  } catch (error) {
    if (error instanceof AirRoiError) {
      return {
        path,
        ok: false,
        status: error.status ?? null,
        reason: error.reason,
        detail: error.detail ?? null,
        shape: null,
      };
    }
    return { path, ok: false, status: null, reason: "network", detail: null, shape: null };
  }
}
