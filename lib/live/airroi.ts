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
 * The comps query, in ONE place.
 *
 * Every parameter here is required by the service. Three separate
 * copies of this list existed and each dropped a different pair at
 * least once, so there is one now and everything reads it.
 */
export function compsParams(
  lat: number,
  lon: number,
  opts: { bedrooms?: number; baths?: number; guests?: number }
): Record<string, string> {
  const bedrooms = opts.bedrooms ?? 2;
  return {
    latitude: String(lat),
    longitude: String(lon),
    bedrooms: String(bedrooms),
    baths: (opts.baths ?? Math.max(1, bedrooms)).toFixed(1),
    guests: String(opts.guests ?? Math.max(2, bedrooms * 2)),
    currency: "native",
  };
}
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

/**
 * The market's headline figures — occupancy, ADR, RevPAR, revenue,
 * active listings. POST, with the market object lookup returns.
 */
export const MARKET_SUMMARY_PATH = "/markets/summary";

/** The same figures as a monthly series with percentiles. POST. */
export const MARKET_METRICS_PATH = "/markets/metrics/all";

/**
 * Their own revenue model for a specific property.
 *
 * Takes the property (bedrooms, baths, guests, a point) and returns a
 * revenue estimate, an ADR, an occupancy, percentiles for each, a
 * monthly revenue distribution AND the comparable listings it used —
 * all in one billed call. Everything the analyzer fetches separately,
 * plus the percentiles the revenue range currently has to invent.
 */
export const ESTIMATE_PATH = "/calculator/estimate";

/** Comps move with new bookings; market aggregates barely move at all. */
export const COMPS_REVALIDATE_SECONDS = 86_400; // 1 day
export const MARKET_REVALIDATE_SECONDS = 604_800; // 7 days

/**
 * A hard ceiling on billed calls, counted here rather than trusted to
 * the callers.
 *
 * Every guard above this one rations something adjacent — distinct
 * areas per day, markets per batch — and each of them can be right
 * while the bill still runs away, because none of them counts the thing
 * that costs money. This counts calls.
 *
 * Fifty a day. The measured price is $0.18 a call — eighteen times the
 * published floor, which evidently applies to some endpoint this
 * product does not use — so fifty is about nine dollars of exposure per
 * instance per day.
 *
 * Per-instance and per-day, like the quota beside it. A serverless
 * fleet means the true figure is this times however many instances
 * happen to be warm, so it is a brake rather than a lock. Worth
 * knowing before treating it as a guarantee: three warm instances is
 * roughly twenty-seven dollars a day, which is most of a small balance.
 *
 * A cached analysis never reaches this counter, and with students
 * converging on one course city list most analyses are cached. The
 * ceiling exists for the day something goes wrong, not for the
 * ordinary case.
 */
const DAILY_CALL_BUDGET = (() => {
  const raw = Number(process.env.AIRROI_DAILY_CALLS);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 50;
})();

let spentDay = "";
let spentCalls = 0;

function budget(): { used: number; cap: number; left: number } {
  const today = new Date().toISOString().slice(0, 10);
  if (spentDay !== today) {
    spentDay = today;
    spentCalls = 0;
  }
  return {
    used: spentCalls,
    cap: DAILY_CALL_BUDGET,
    left: Math.max(0, DAILY_CALL_BUDGET - spentCalls),
  };
}

/** What this instance has spent today. Surfaced by /api/usage. */
export function airRoiBudget(): { used: number; cap: number; left: number } {
  return budget();
}

export class AirRoiError extends Error {
  constructor(
    readonly reason: "no-key" | "auth" | "quota" | "http" | "network" | "budget",
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
   * Keep the coordinate either way; record only whether it is exact.
   *
   * Airbnb blurs a listing's position until it is booked, and in
   * practice almost every comp comes back blurred — all twelve in the
   * first live pull. An earlier version of this discarded those and let
   * the map fall back to its scatter, which put the pin at a hashed
   * random bearing from the subject. That is strictly worse: the blur
   * is a small circle around the real address, the scatter is anywhere
   * on a ring. Throwing away a good approximation to replace it with a
   * worse one is not caution, it is just a different error.
   *
   * So the position is used and `exactLocation` carries the caveat.
   */
  const hasPoint =
    lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const exact = group(row, "location_info")?.exact_location;
  const placed = hasPoint
    ? { lat: lat!, lon: lon!, exactLocation: exact === true }
    : {};

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

/** avg / p25 / p50 / p75 / p90, as their percentile blocks arrive. */
export interface Percentiles {
  avg: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
}

function mapPercentiles(raw: unknown): Percentiles | null {
  const g = raw && typeof raw === "object" ? (raw as Row) : null;
  if (!g) return null;
  const read = (k: string) => pickNumber(g, [k]);
  return { avg: read("avg"), p25: read("p25"), p50: read("p50"), p75: read("p75"), p90: read("p90") };
}

export interface PropertyEstimate {
  /** Their projected annual revenue for this property. */
  revenue: number | null;
  adr: number | null;
  /** Fraction. */
  occupancy: number | null;
  percentiles: {
    revenue: Percentiles | null;
    adr: Percentiles | null;
    occupancy: Percentiles | null;
  };
  /** Twelve numbers, one per month — the seasonality of this address. */
  monthlyRevenue: number[] | null;
  /** The listings their estimate was built from. */
  comps: StrComp[];
}

/**
 * One month of a market's history, flattened.
 *
 * Their payload gives avg/p25/p50/p75/p90 for every measure; the charts
 * plot a single line, so the average is taken and the rest dropped
 * rather than carried through a store and three components unused.
 */
export interface LiveMarketMonth {
  /** YYYY-MM-01, matching the seeded series so both feed one chart. */
  month: string;
  adr: number;
  /** Fraction. */
  occupancy: number;
  revenue: number | null;
  revpar: number | null;
}

export interface MarketSummary {
  adr: number | null;
  /** Fraction. */
  occupancy: number | null;
  revpar: number | null;
  revenue: number | null;
  activeListings: number | null;
  bookingLeadTime: number | null;
  lengthOfStay: number | null;
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
  revalidate: number,
  /** Their market endpoints are POST with a JSON body; the listing and
   *  calculator ones are GET with a query string. Probing the POST
   *  paths with GET is what produced three 404s reading "Invalid
   *  endpoint path", and the conclusion that market metrics did not
   *  exist. They exist. */
  body?: unknown
): Promise<unknown> {
  const key = process.env.AIRROI_API_KEY;
  if (!key) throw new AirRoiError("no-key");

  // Counted before the request, not after: a call that times out or
  // errors has still been made and, on most metered APIs, still
  // billed. Counting successes only is how a budget gets quietly
  // exceeded by the failures.
  const remaining = budget();
  if (remaining.left <= 0) {
    throw new AirRoiError(
      "budget",
      undefined,
      `daily call budget spent (${remaining.used}/${remaining.cap}). ` +
        "Raise AIRROI_DAILY_CALLS deliberately; the default is low because these calls are not cheap."
    );
  }
  spentCalls += 1;

  const url = body
    ? `${BASE}${path}`
    : `${BASE}${path}?${new URLSearchParams(params)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      ...(body
        ? {
            method: "POST",
            body: JSON.stringify(body),
          }
        : {}),
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
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

/** Comps with a distance filled in, nearest first. Shared by the
 *  comparables endpoint and the calculator's own comp set. */
function withDistance(comps: StrComp[], subject: { lat: number; lon: number }): StrComp[] {
  return comps
    .map((c) =>
      c.distanceMiles > 0 || c.lat === undefined || c.lon === undefined
        ? c
        : {
            ...c,
            distanceMiles:
              Math.round(milesBetween(subject, { lat: c.lat, lon: c.lon }) * 10) / 10,
          }
    )
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
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
  /**
   * baths and guests are REQUIRED — the service answers
   * "query param baths must not be null" without them, so leaving them
   * off is not a degraded request, it is a guaranteed 400.
   *
   * They were modelled as optional here and omitted when absent, which
   * meant three separate copies of this parameter list each had to
   * remember to pass them, and three separate times one didn't: the
   * sweep, the single-endpoint probe, and this, the path the product
   * actually uses. Defaulting them where the request is built ends
   * that — a caller can still say what it knows, and one that says
   * nothing gets a request that works instead of one that cannot.
   *
   * The defaults follow the shape of the housing stock: about a bath
   * per bedroom, two guests to a bedroom.
   */

  const body = await call(
    COMPS_PATH,
    compsParams(opts.lat, opts.lon, opts),
    COMPS_REVALIDATE_SECONDS
  );
  return withDistance(
    extractArray(body).map(mapComp).filter((c): c is StrComp => c !== null),
    { lat: opts.lat, lon: opts.lon }
  ).slice(0, opts.limit ?? 12);
}

/**
 * Their revenue model for one property, and the comps behind it.
 *
 * One call where the analyzer previously made one for comps and then
 * derived everything itself. The derivation stays — the projection is
 * still computed from the comp set displayed beside it, which is the
 * one invariant this product cannot give up — but their figures come
 * along as an independent read, and their percentiles are real where
 * the revenue range previously had to spread a band around a point.
 */
export async function fetchEstimate(opts: {
  lat: number;
  lon: number;
  bedrooms?: number;
  baths?: number;
  guests?: number;
  radiusMiles?: number;
}): Promise<PropertyEstimate> {
  const params = compsParams(opts.lat, opts.lon, opts);
  // The calculator names its coordinates lat/lng where comparables says
  // latitude/longitude. Same service, two conventions.
  const body = await call(
    ESTIMATE_PATH,
    {
      lat: String(opts.lat),
      lng: String(opts.lon),
      bedrooms: params.bedrooms,
      baths: params.baths,
      guests: params.guests,
      ...(opts.radiusMiles ? { radius: String(opts.radiusMiles) } : {}),
      currency: "native",
    },
    COMPS_REVALIDATE_SECONDS
  );

  const row = (body && typeof body === "object" ? body : {}) as Row;
  const pct = group(row, "percentiles");
  const monthly = row.monthly_revenue_distributions;
  const subject = { lat: opts.lat, lon: opts.lon };

  return {
    revenue: pickNumber(row, ["revenue"]),
    adr: pickNumber(row, ["average_daily_rate"]),
    occupancy: toFraction(pickNumber(row, ["occupancy"])),
    percentiles: {
      revenue: mapPercentiles(pct?.revenue),
      adr: mapPercentiles(pct?.average_daily_rate),
      occupancy: mapPercentiles(pct?.occupancy),
    },
    monthlyRevenue: Array.isArray(monthly)
      ? monthly.filter((n): n is number => typeof n === "number")
      : null,
    comps: withDistance(
      extractArray({ listings: row.comparable_listings })
        .map(mapComp)
        .filter((c): c is StrComp => c !== null),
      subject
    ),
  };
}

/**
 * A market's headline figures.
 *
 * POST, with the market object /markets/lookup returns. Getting the
 * method wrong is what made three probes answer 404 "Invalid endpoint
 * path" and produced the conclusion that market metrics were simply
 * unavailable. They were available the whole time.
 */
export async function fetchMarketSummary(market: {
  country?: string;
  region?: string;
  locality?: string;
  district?: string;
}): Promise<MarketSummary | null> {
  const body = await call(MARKET_SUMMARY_PATH, {}, MARKET_REVALIDATE_SECONDS, {
    market,
    currency: "native",
  });
  const row = (body && typeof body === "object" ? body : null) as Row | null;
  if (!row) return null;
  return {
    adr: pickNumber(row, ["average_daily_rate"]),
    occupancy: toFraction(pickNumber(row, ["occupancy"])),
    revpar: pickNumber(row, ["rev_par", "revpar"]),
    revenue: pickNumber(row, ["revenue"]),
    activeListings: pickNumber(row, ["active_listings_count"]),
    bookingLeadTime: pickNumber(row, ["booking_lead_time"]),
    lengthOfStay: pickNumber(row, ["length_of_stay"]),
  };
}

/**
 * A market's monthly history.
 *
 * POST, like every other market endpoint. Twelve months by default,
 * which is what the charts draw and what "trailing twelve" means
 * everywhere else in this product.
 *
 * A month with no rate or no occupancy is dropped rather than zeroed:
 * a zero plots as a real collapse and reads as one.
 */
export async function fetchMarketMetrics(
  market: {
    country?: string;
    region?: string;
    locality?: string;
    district?: string;
  },
  numMonths = 12
): Promise<LiveMarketMonth[]> {
  const body = await call(MARKET_METRICS_PATH, {}, MARKET_REVALIDATE_SECONDS, {
    market,
    currency: "native",
    num_months: numMonths,
  });

  const rows = (body && typeof body === "object" ? (body as Row).results : null) as
    | unknown[]
    | null;
  if (!Array.isArray(rows)) return [];

  const avg = (row: Row, key: string): number | null => {
    const g = group(row, key);
    return g ? pickNumber(g, ["avg", "p50"]) : pickNumber(row, [key]);
  };

  return rows
    .map((raw): LiveMarketMonth | null => {
      if (!raw || typeof raw !== "object") return null;
      const row = raw as Row;
      const month = normaliseMonth(pickString(row, ["date", "month"]));
      const adr = avg(row, "average_daily_rate");
      const occupancy = toFraction(avg(row, "occupancy"));
      if (!month || adr === null || adr <= 0 || occupancy === null) return null;
      return {
        month,
        adr: Math.round(adr),
        occupancy: Math.round(occupancy * 1000) / 1000,
        revenue: avg(row, "revenue"),
        revpar: avg(row, "revpar"),
      };
    })
    .filter((m): m is LiveMarketMonth => m !== null)
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Their date to the seeded series' YYYY-MM-01.
 *
 * Both shapes have turned up in this codebase's vendors — a full
 * timestamp and a bare month — so this takes the first seven characters
 * when they parse as a year and month, and refuses anything else rather
 * than inventing a date for a row to sit at.
 */
function normaliseMonth(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

/**
 * A point's market IDENTITY. Not its numbers.
 *
 * Measured against the live service: /markets/lookup returns full_name,
 * country, region, locality and district, and nothing else. There is no
 * ADR here, no occupancy, no revenue. /markets/metrics/all,
 * /markets/metrics/occupancy and /markets/overview all answer 404
 * "Invalid endpoint path", so whatever serves market-level aggregates
 * is not at any address we have found.
 *
 * That turns out not to matter. The projection derives its ADR and
 * occupancy from the comp set through lib/calc/comps, and comps drawn
 * around the actual property are a better basis than a ZIP-wide mean
 * would have been — their market identifier resolves to ZIP granularity
 * anyway ("32202, Jacksonville, Florida, United States").
 *
 * Kept because the market name is worth having and the call is cheap,
 * but nothing on a page requests it: an endpoint that cannot answer the
 * question it was written for should not be billed on every analysis.
 */
export async function fetchMarketIdentity(opts: {
  lat: number;
  lon: number;
}): Promise<{
  fullName: string | null;
  /** Exactly the shape /markets/summary wants as its `market`. */
  market: { country?: string; region?: string; locality?: string; district?: string } | null;
}> {
  const body = await call(
    MARKET_PATH,
    { lat: String(opts.lat), lng: String(opts.lon) },
    MARKET_REVALIDATE_SECONDS
  );
  const row = (body && typeof body === "object" ? body : null) as Row | null;
  const part = (k: string) => (row ? pickString(row, [k]) ?? undefined : undefined);
  return {
    fullName: fullNameOf(body),
    market: row
      ? {
          country: part("country"),
          region: part("region"),
          locality: part("locality"),
          district: part("district"),
        }
      : null,
  };
}

/**
 * Retained for the shape of a market payload we have not found yet.
 * Nothing calls it; if a metrics endpoint turns up, this is where its
 * response gets normalised.
 */
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
  // Every parameter the service requires, in one place, shared with the
  // real call path — see compsParams.
  { path: COMPS_PATH, params: (lat, lon) => compsParams(lat, lon, {}) },
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
