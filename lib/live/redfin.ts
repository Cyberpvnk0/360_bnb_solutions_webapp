/**
 * Redfin — furnished rentals, asserted at the source.
 *
 * This exists because Redfin ships a Furnished filter in its own search.
 * That is a categorically better answer than anything the description
 * miner can give: when a search is furnished-filtered, every listing
 * that comes back is furnished because REDFIN says so, not because a
 * regex found the word in a paragraph we scraped. No prose to read, no
 * boilerplate to mistake for a description, no false tag off a footer —
 * and one request per market instead of one per property.
 *
 * Reached through ScraperAPI's Redfin structured endpoint, which returns
 * parsed JSON rather than HTML, so there is no extraction ladder here.
 *
 * The field names below are PROVISIONAL — ScraperAPI's docs are not
 * reachable from the build environment, so the mapper reads a list of
 * plausible aliases for each value and the route ships a `shape=1`
 * probe. Pin these to the real names on the first live response and
 * delete the aliases that never fire.
 */

import type { Market, PropertyType, RentalListing } from "@/lib/mock/types";

const SEARCH_ENDPOINT = "https://api.scraperapi.com/structured/redfin/search";

/** A day: rental inventory turns over, and this is one call per market. */
export const REDFIN_REVALIDATE_SECONDS = 86_400;

/**
 * Redfin addresses a city by a numeric id in its URL path, which cannot
 * be derived from a name. Seeded from real URLs; unmapped markets simply
 * have no Redfin search until their id is added, which the caller
 * reports honestly rather than guessing a wrong city.
 */
export const REDFIN_CITY_ID: Record<string, number> = {
  jacksonville: 8907,
};

export function redfinCoversMarket(market: Market): boolean {
  return REDFIN_CITY_ID[market.slug] !== undefined;
}

/**
 * A Redfin rentals search URL, optionally narrowed to furnished units.
 * Mirrors the real URL shape:
 *   /city/8907/FL/Jacksonville/rentals/filter/is-furnished
 */
export function redfinRentalsUrl(
  market: Market,
  opts: { furnished?: boolean } = {}
): string | null {
  const id = REDFIN_CITY_ID[market.slug];
  if (id === undefined) return null;
  const city = market.name.trim().replace(/\s+/g, "-");
  const base = `https://www.redfin.com/city/${id}/${market.stateCode}/${city}/rentals`;
  return opts.furnished ? `${base}/filter/is-furnished` : base;
}

/** Why a Redfin fetch failed, in words the UI can show. */
export class RedfinError extends Error {
  constructor(
    readonly reason:
      | "no-key"
      | "no-city"
      | "auth"
      | "forbidden"
      | "quota"
      | "http"
      | "network",
    readonly status?: number,
    readonly detail?: string
  ) {
    super(`Redfin ${reason}${status ? ` (${status})` : ""}`);
    this.name = "RedfinError";
  }
}

/* ------------------------------------------------------------------ */
/* Tolerant reading — every name here is a guess until pinned          */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

function pick(row: Row, keys: readonly string[]): unknown {
  for (const key of keys) {
    // Dotted paths let one alias reach into a nested object.
    const value = key
      .split(".")
      .reduce<unknown>(
        (acc, part) =>
          acc && typeof acc === "object"
            ? (acc as Row)[part]
            : undefined,
        row
      );
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/** Numbers arrive as numbers, as "$1,850", or as "1,850/mo". */
function pickNumber(row: Row, keys: readonly string[]): number | undefined {
  const raw = pick(row, keys);
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const cleaned = Number(raw.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(cleaned) && cleaned > 0) return cleaned;
  }
  return undefined;
}

function pickString(row: Row, keys: readonly string[]): string | undefined {
  const raw = pick(row, keys);
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

const ADDRESS_KEYS = [
  "address",
  "streetLine",
  "streetAddress",
  "addressLine1",
  "fullAddress",
  "location.streetLine",
] as const;
const CITY_KEYS = ["city", "location.city", "addressCity"] as const;
const STATE_KEYS = ["state", "stateCode", "location.state"] as const;
const PRICE_KEYS = ["price", "rentPrice", "rent", "monthlyRent", "listPrice"] as const;
const BEDS_KEYS = ["beds", "bedrooms", "numBeds"] as const;
const BATHS_KEYS = ["baths", "bathrooms", "numBaths"] as const;
const SQFT_KEYS = ["sqFt", "squareFeet", "squareFootage", "size"] as const;
const LAT_KEYS = ["latitude", "lat", "latLong.latitude", "location.latitude"] as const;
const LON_KEYS = ["longitude", "lng", "lon", "latLong.longitude", "location.longitude"] as const;
const URL_KEYS = ["url", "listingUrl", "propertyUrl", "detailUrl", "link"] as const;
const TYPE_KEYS = ["propertyType", "homeType", "type"] as const;

const TYPE_MAP: Record<string, PropertyType> = {
  "single family": "house",
  "single family residential": "house",
  house: "house",
  condo: "condo",
  condominium: "condo",
  townhouse: "townhome",
  townhome: "townhome",
  apartment: "apartment",
  "multi family": "apartment",
  "multi-family": "apartment",
};

function propertyTypeOf(row: Row): PropertyType {
  const raw = pickString(row, TYPE_KEYS)?.toLowerCase();
  // Redfin's rental inventory is apartment-heavy; that is the honest
  // default when the feed doesn't say, and it never invents a house.
  return (raw ? TYPE_MAP[raw] : undefined) ?? "apartment";
}

/** Containers a search response might wrap its listings in. */
const ARRAY_KEYS = [
  "homes",
  "listings",
  "results",
  "properties",
  "data",
  "items",
] as const;

export function extractListings(body: unknown): Row[] {
  if (Array.isArray(body)) return body as Row[];
  if (!body || typeof body !== "object") return [];
  for (const key of ARRAY_KEYS) {
    const value = (body as Row)[key];
    if (Array.isArray(value)) return value as Row[];
    // One level of nesting: { data: { homes: [...] } }
    if (value && typeof value === "object") {
      for (const inner of ARRAY_KEYS) {
        const nested = (value as Row)[inner];
        if (Array.isArray(nested)) return nested as Row[];
      }
    }
  }
  return [];
}

/**
 * One Redfin row → our RentalListing, or null when it can't be used.
 *
 * `furnished` is the caller's assertion that this row came from a
 * furnished-FILTERED search. That is the only claim of its kind in the
 * codebase that isn't mined from text: Redfin applied the filter, so the
 * tag is theirs. An unfiltered search leaves amenities unknown rather
 * than claiming the unit has none.
 */
export function mapRedfinListing(
  raw: Row,
  market: Market,
  opts: { furnished: boolean; index: number }
): RentalListing | null {
  const rentMonthly = pickNumber(raw, PRICE_KEYS);
  if (!rentMonthly || rentMonthly <= 0) return null;

  const lat = pickNumber(raw, LAT_KEYS);
  const lon = pickNumber(raw, LON_KEYS);
  if (lat === undefined || lon === undefined) return null;

  const address = pickString(raw, ADDRESS_KEYS);
  if (!address) return null;

  const rawBeds = pickNumber(raw, BEDS_KEYS);
  // Studios read as 0 and are a legitimate 1-bedroom for our maths.
  const bedrooms = Math.min(5, Math.max(1, Math.round(rawBeds ?? 1)));
  const bathrooms = pickNumber(raw, BATHS_KEYS) ?? 1;
  const detail = pickString(raw, URL_KEYS);

  // Stable within a market's feed so React keys and saved lists hold.
  const key = detail
    ? detail.replace(/[^a-zA-Z0-9]+/g, "-").slice(-48)
    : `${opts.index}`;

  return {
    id: `live--${market.slug}--rf-${key}`,
    analysisId: `r--live--${market.slug}--rf-${key}`,
    address,
    city: pickString(raw, CITY_KEYS) ?? market.name,
    stateCode: pickString(raw, STATE_KEYS) ?? market.stateCode,
    marketSlug: market.slug,
    lat,
    lon,
    bedrooms,
    bathrooms,
    sqft: Math.round(pickNumber(raw, SQFT_KEYS) ?? 0),
    propertyType: propertyTypeOf(raw),
    rentMonthly: Math.round(rentMonthly),
    daysOnMarket: Math.max(0, Math.round(pickNumber(raw, ["daysOnMarket", "dom"]) ?? 0)),
    petFriendly: false,
    features: opts.furnished ? ["Furnished"] : [],
    // Only a furnished-filtered search tells us anything about amenities.
    featuresKnown: opts.furnished,
  };
}

/* ------------------------------------------------------------------ */
/* Fetch                                                               */
/* ------------------------------------------------------------------ */

export interface RedfinFetch {
  listings: RentalListing[];
  /** Raw rows, for the shape probe only — never rendered. */
  raw: Row[];
  credits: number | null;
  searchUrl: string;
}

function creditsFrom(res: Response): number | null {
  for (const header of ["sa-credit-cost", "x-credit-cost", "sa-credits-used"]) {
    const value = res.headers.get(header);
    if (value !== null && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

/**
 * Rentals for one market, optionally only the furnished ones.
 * One request per market per day, shared by every user.
 */
export async function fetchRedfinRentals(
  market: Market,
  opts: { furnished?: boolean } = {}
): Promise<RedfinFetch> {
  const key = process.env.SCRAPERAPI_KEY;
  if (!key) throw new RedfinError("no-key");
  const searchUrl = redfinRentalsUrl(market, opts);
  if (!searchUrl) throw new RedfinError("no-city");

  const params = new URLSearchParams({
    api_key: key,
    url: searchUrl,
    country_code: "us",
  });

  let res: Response;
  try {
    res = await fetch(`${SEARCH_ENDPOINT}?${params}`, {
      next: { revalidate: REDFIN_REVALIDATE_SECONDS },
    });
  } catch {
    throw new RedfinError("network");
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => ""))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
    if (res.status === 401) throw new RedfinError("auth", 401, detail);
    if (res.status === 403) throw new RedfinError("forbidden", 403, detail);
    if (res.status === 429) throw new RedfinError("quota", 429, detail);
    throw new RedfinError("http", res.status, detail);
  }

  const body: unknown = await res.json().catch(() => null);
  const raw = extractListings(body);
  const furnished = Boolean(opts.furnished);
  const listings = raw
    .map((row, index) => mapRedfinListing(row, market, { furnished, index }))
    .filter((l): l is RentalListing => l !== null)
    .sort((a, b) => a.rentMonthly - b.rentMonthly);

  return { listings, raw, credits: creditsFrom(res), searchUrl };
}
