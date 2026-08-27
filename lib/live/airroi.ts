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
 * FIELD NAMES ARE STILL PARTLY PROVISIONAL. The normalizers accept
 * several plausible spellings per figure, now including the ones their
 * market payload is documented to use. Hit /api/str?shape=1 with a real
 * key once and pin them to what actually arrives — the rest of the
 * file, and every caller, stays exactly as it is.
 *
 * Billing is per call, between $0.01 and $1.00 depending on endpoint,
 * which is the whole reason the revalidate windows below are long.
 */

import type { StrComp } from "@/lib/mock/types";

const BASE = "https://api.airroi.com";

/** Comparable listings around a point — the comps behind a projection. */
export const COMPS_PATH = "/listings/comparables";
/** A coordinate's market, with its headline KPIs. */
export const MARKET_PATH = "/markets/lookup";

/** Comps move with new bookings; market aggregates barely move at all. */
export const COMPS_REVALIDATE_SECONDS = 86_400; // 1 day
export const MARKET_REVALIDATE_SECONDS = 604_800; // 7 days

export class AirRoiError extends Error {
  constructor(
    readonly reason: "no-key" | "auth" | "quota" | "http" | "network",
    readonly status?: number
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

const ADR_KEYS = ["adr", "avg_daily_rate", "averageDailyRate", "average_daily_rate", "avgDailyRate", "nightlyRate", "price"];
const OCC_KEYS = ["occupancy", "avg_occupancy", "occupancyRate", "occupancy_rate", "occ"];
const REV_KEYS = ["annualRevenue", "annual_revenue", "revenueLtm", "revenue_ltm", "avg_revpar", "revpar", "revenue"];
const BEDS_KEYS = ["bedrooms", "beds", "bedroomCount"];
const BATHS_KEYS = ["bathrooms", "baths", "bathroomCount"];
const DIST_KEYS = ["distanceMiles", "distance_miles", "distance"];
const NAME_KEYS = ["title", "name", "listingName", "listing_title"];
const ID_KEYS = ["id", "listingId", "listing_id", "airbnbId"];
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

  const adr = pickNumber(row, ADR_KEYS);
  const occupancy = toFraction(pickNumber(row, OCC_KEYS));
  if (adr === null || adr <= 0 || occupancy === null) return null;

  const bedrooms = pickNumber(row, BEDS_KEYS) ?? 0;
  const bathrooms = pickNumber(row, BATHS_KEYS) ?? 1;
  const distance = pickNumber(row, DIST_KEYS);
  const id = pickString(row, ID_KEYS) ?? `airroi-${index}`;

  // Only a pair counts. Half a coordinate would place a pin on the
  // prime meridian and look deliberate doing it.
  const lat = pickNumber(row, LAT_KEYS);
  const lon = pickNumber(row, LON_KEYS);
  const placed =
    lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
      ? { lat, lon }
      : {};

  return {
    id: `sc-live-${id}`,
    name: pickString(row, NAME_KEYS) ?? `${Math.max(1, Math.round(bedrooms))} BR nearby rental`,
    bedrooms: Math.max(0, Math.round(bedrooms)),
    bathrooms: Math.max(0.5, bathrooms),
    adr: Math.round(adr),
    // Whole-point storage, like every other occupancy in the product.
    occupancy: Math.round(occupancy * 100) / 100,
    distanceMiles: distance === null ? 0 : Math.round(distance * 10) / 10,
    ...placed,
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
    if (res.status === 401 || res.status === 403) {
      throw new AirRoiError("auth", res.status);
    }
    if (res.status === 402 || res.status === 429) {
      throw new AirRoiError("quota", res.status);
    }
    throw new AirRoiError("http", res.status);
  }
  return res.json().catch(() => null);
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
  return extractArray(body)
    .map(mapComp)
    .filter((c): c is StrComp => c !== null)
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
  { path: COMPS_PATH, params: (lat, lon) => ({ latitude: String(lat), longitude: String(lon), bedrooms: "2", currency: "native" }) },
  { path: MARKET_PATH, params: (lat, lon) => ({ lat: String(lat), lng: String(lon) }) },
  { path: "/markets/search", params: () => ({ query: "jacksonville" }) },
  { path: "/markets/overview", params: (lat, lon) => ({ lat: String(lat), lng: String(lon) }) },
];

export interface ProbeOutcome {
  path: string;
  ok: boolean;
  status: number | null;
  reason: string | null;
}

/** One candidate, reporting rather than throwing — a 404 is the answer
 *  the sweep is looking for, not a failure of the sweep. */
export async function probeEndpoint(
  path: string,
  params: Record<string, string>
): Promise<ProbeOutcome & { shape: unknown }> {
  try {
    const body = await call(path, params, 60);
    return { path, ok: true, status: 200, reason: null, shape: body };
  } catch (error) {
    if (error instanceof AirRoiError) {
      return { path, ok: false, status: error.status ?? null, reason: error.reason, shape: null };
    }
    return { path, ok: false, status: null, reason: "network", shape: null };
  }
}
