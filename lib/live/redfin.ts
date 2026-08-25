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

import { mineFeatures } from "@/lib/live/features";
import { geocodeAll } from "@/lib/live/geocode";
import type { Market, PropertyType, RentalListing } from "@/lib/mock/types";

/**
 * Versioned path, confirmed from ScraperAPI's own generated snippet.
 * The unversioned `/structured/redfin/search` answers, and bills, but
 * returns nothing this mapper can read — a wrong endpoint that costs
 * money and looks like an empty market.
 */
export const REDFIN_SEARCH_ENDPOINT =
  "https://api.scraperapi.com/structured/redfin/search/v1";

/** A day: rental inventory turns over, and this is one call per page. */
export const REDFIN_REVALIDATE_SECONDS = 86_400;

/**
 * Pages to follow.
 *
 * Redfin paginates at ~41 rows and hands back the next page URLs, so
 * reading only the first page silently shows a third of a market and
 * looks like the search was narrower than it was. Each page is its own
 * billed request, so this is capped and tunable.
 */
export const DEFAULT_MAX_PAGES = 4;

function maxPages(): number {
  const raw = Number(process.env.REDFIN_MAX_PAGES);
  return Number.isFinite(raw) && raw > 0
    ? Math.min(10, Math.floor(raw))
    : DEFAULT_MAX_PAGES;
}

/** The next-page links a search response hands back, absolute. */
export function nextPageUrls(body: unknown): string[] {
  const raw = (body as { next_pages?: unknown })?.next_pages;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((u): u is string => typeof u === "string" && u.trim() !== "")
    .map((u) =>
      u.startsWith("http") ? u : `https://www.redfin.com${u.startsWith("/") ? "" : "/"}${u}`
    );
}

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

/**
 * Rent, wherever the row buries it.
 *
 * Redfin's search rows wrap price in an array of objects rather than a
 * scalar, so this digs one level in and takes the first plausible
 * monthly figure it finds.
 */
export function priceOf(row: Row): number | undefined {
  const direct = pickNumber(row, ["price", "rentPrice", "rent", "monthlyRent"]);
  if (direct !== undefined) return direct;

  const wrapped = row.price;
  const candidates: unknown[] = Array.isArray(wrapped) ? wrapped : [wrapped];
  for (const entry of candidates) {
    if (typeof entry === "number" && entry > 0) return entry;
    if (typeof entry === "string") {
      const n = Number(entry.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(n) && n > 0) return n;
    }
    if (entry && typeof entry === "object") {
      for (const value of Object.values(entry as Row)) {
        if (typeof value === "number" && value > 0) return value;
        if (typeof value === "string") {
          const n = Number(value.replace(/[^0-9.]/g, ""));
          // A monthly rent, not a bedroom count or a "1" from "1 of 3".
          if (Number.isFinite(n) && n >= 200) return n;
        }
      }
    }
  }
  return undefined;
}

function pickString(row: Row, keys: readonly string[]): string | undefined {
  const raw = pick(row, keys);
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

/* Pinned to a live response. Redfin's search rows carry display
 * STRINGS ("2 beds", "1.5 baths", "940 sq ft"), a price wrapped in an
 * array of objects, and — notably — no coordinates at all. */
const ADDRESS_KEYS = ["address", "streetLine", "streetAddress"] as const;
const CITY_KEYS = ["city", "location.city"] as const;
const STATE_KEYS = ["state", "stateCode"] as const;
const BEDS_KEYS = ["number_beds", "beds", "bedrooms"] as const;
const BATHS_KEYS = ["number_baths", "baths", "bathrooms"] as const;
const SQFT_KEYS = ["sq_ft", "sqFt", "squareFeet"] as const;
const LAT_KEYS = ["latitude", "lat", "latLong.latitude"] as const;
const LON_KEYS = ["longitude", "lng", "lon", "latLong.longitude"] as const;
const URL_KEYS = ["url", "listingUrl", "detailUrl"] as const;
const TYPE_KEYS = ["propertyType", "homeType"] as const;
/** Redfin ships a thumbnail on most rows — a real photo of the unit. */
const PHOTO_KEYS = ["thumbnail_img_url", "thumbnailUrl", "photoUrl"] as const;
/** Short display chips beside a listing — a second amenity signal. */
const FACTS_KEYS = ["key_facts", "keyFacts", "facts", "badge"] as const;

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
  // Pinned from a live response: the container is singular.
  "listing",
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
/** Why a row couldn't be used — counted so a zero result explains
 *  itself instead of looking like an empty market. */
export type SkipReason =
  | "no-price"
  | "no-address"
  | "no-coordinates"
  | "no-beds";

export type MapResult =
  | { ok: true; listing: RentalListing }
  | { ok: false; skip: SkipReason };

/**
 * One Redfin row → our RentalListing.
 *
 * `furnished` is the caller's assertion that this row came from a
 * furnished-FILTERED search. That is the only amenity claim in the
 * codebase not mined from text: Redfin applied the filter, so the tag is
 * theirs. An unfiltered search leaves amenities unknown rather than
 * claiming the unit has none.
 *
 * Coordinates are NOT in Redfin's search rows, so they must be supplied
 * by the caller (a geocoder). Without them the row is skipped rather
 * than pinned at the city centre — a map pin on the wrong street is a
 * lie a student would act on.
 */
export function mapRedfinListing(
  raw: Row,
  market: Market,
  opts: {
    furnished: boolean;
    index: number;
    coords?: { lat: number; lon: number };
  }
): MapResult {
  const rentMonthly = priceOf(raw);
  if (!rentMonthly || rentMonthly <= 0) return { ok: false, skip: "no-price" };

  const address = pickString(raw, ADDRESS_KEYS);
  if (!address) return { ok: false, skip: "no-address" };

  const lat = pickNumber(raw, LAT_KEYS) ?? opts.coords?.lat;
  const lon = pickNumber(raw, LON_KEYS) ?? opts.coords?.lon;
  if (lat === undefined || lon === undefined) {
    return { ok: false, skip: "no-coordinates" };
  }

  // "2 beds" / "1.5 baths" / "940 sq ft" — display strings, not numbers.
  const bedsText = pickString(raw, BEDS_KEYS) ?? "";
  const rawBeds = pickNumber(raw, BEDS_KEYS);
  // A studio genuinely has no bedroom count and counts as one unit of
  // sleeping space; anything else without a number is a count we do not
  // have, and defaulting it to 1 would understate real two- and
  // three-bedroom units across a whole market.
  const bedrooms =
    rawBeds !== undefined
      ? Math.min(5, Math.max(1, Math.round(rawBeds)))
      : /studio/i.test(bedsText)
        ? 1
        : undefined;
  if (bedrooms === undefined) return { ok: false, skip: "no-beds" };

  // A floor, not a guess: every unit has at least one bathroom.
  const bathrooms = pickNumber(raw, BATHS_KEYS) ?? 1;
  const detail = pickString(raw, URL_KEYS);

  // The short chips beside a listing are a second amenity signal, read
  // through the one shared miner so "Furnished" means the same thing
  // here as everywhere else — negations included.
  const factsRaw = pick(raw, FACTS_KEYS);
  const facts = Array.isArray(factsRaw)
    ? factsRaw.filter((f): f is string => typeof f === "string")
    : [];
  const minedFacts = mineFeatures(facts) ?? [];

  const features = opts.furnished
    ? [...new Set(["Furnished", ...minedFacts])]
    : minedFacts;

  // Stable within a market's feed so React keys and saved lists hold.
  const key = detail
    ? detail.replace(/[^a-zA-Z0-9]+/g, "-").slice(-48)
    : `${opts.index}`;

  return {
    ok: true,
    listing: {
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
      // Redfin's search rows carry no listing date. Left absent rather
      // than zeroed, which would badge all eighty "New, listed today".
      daysOnMarket: pickNumber(raw, ["daysOnMarket", "dom"]),
      photoUrl: pickString(raw, PHOTO_KEYS),
      // The listing's own page: what the panel links to, and where its
      // full gallery is fetched from on demand.
      sourceUrl: detail
        ? detail.startsWith("http")
          ? detail
          : `https://www.redfin.com${detail.startsWith("/") ? "" : "/"}${detail}`
        : undefined,
      petFriendly: features.includes("Pet friendly"),
      features,
      // A furnished-filtered search is a real amenity answer; the chips
      // alone are not enough to claim we know the full picture.
      featuresKnown: opts.furnished,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Photo index: Redfin's pictures on another feed's rows               */
/* ------------------------------------------------------------------ */

/**
 * Punctuation-blind, abbreviation-blind address key.
 *
 * Used to decide whether a Redfin row and a RentCast row are the SAME
 * building. A loose match here hangs one property's photo on another's
 * card — the kind of wrong that looks completely right, so the key is
 * built from house number, street name and (where present) unit, and a
 * row that can't produce one is never matched.
 */
export function addressKey(address: string): string | null {
  const cleaned = address
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(lane|ln)\b/g, "ln")
    .replace(/\b(court|ct)\b/g, "ct")
    .replace(/\b(boulevard|blvd)\b/g, "blvd")
    .replace(/\b(terrace|ter)\b/g, "ter")
    .replace(/\b(place|pl)\b/g, "pl")
    .replace(/\b(apartment|apt|unit|ste|suite)\b/g, "unit")
    .replace(/\s+/g, " ")
    .trim();

  const number = cleaned.match(/^\d+/)?.[0];
  if (!number) return null;
  // Everything up to the city: street plus any unit designator.
  const street = cleaned
    .slice(number.length)
    .split(/\bjacksonville\b|\b[a-z]{2}\s+\d{5}\b/)[0]
    // The unit NUMBER distinguishes units; the word in front of it does
    // not, and "#902" strips to a bare number while "Apt 902" doesn't.
    .replace(/\bunit\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (street.length < 3) return null;
  return `${number} ${street}`;
}

/**
 * Redfin's thumbnails for a market, keyed by address.
 *
 * RentCast ships no imagery at all, so its rows show a sketch. Redfin
 * photographs the same city, and one already-cached market search hands
 * back a picture for most of its rows — so where both list the same
 * building, the row can borrow the photo.
 *
 * Bounded by the same page cap as any other search: this covers the
 * listings Redfin returns, not every address in the metro, and the
 * caller reports how many rows actually matched rather than implying
 * full coverage.
 */
export async function fetchRedfinPhotoIndex(
  market: Market
): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  if (!redfinCoversMarket(market)) return index;

  const { raw } = await fetchRedfinRentals(market, { furnished: false });
  for (const row of raw) {
    const address = pickString(row, ADDRESS_KEYS);
    const photo = pickString(row, PHOTO_KEYS);
    if (!address || !photo) continue;
    const key = addressKey(address);
    if (key && !index.has(key)) index.set(key, photo);
  }
  return index;
}

/* ------------------------------------------------------------------ */
/* One listing's full gallery                                          */
/* ------------------------------------------------------------------ */

/**
 * Candidate paths for the per-listing endpoint.
 *
 * The search endpoint turned out to be versioned (`/search/v1`) and the
 * unversioned path billed while returning nothing readable — so rather
 * than guess once and pay for being wrong, this tries the plausible
 * spellings and reports which answered. Pin the winner and delete the
 * rest.
 */
export const REDFIN_LISTING_ENDPOINTS = [
  "https://api.scraperapi.com/structured/redfin/forrent/v1",
  "https://api.scraperapi.com/structured/redfin/for-rent/v1",
  "https://api.scraperapi.com/structured/redfin/listing/v1",
  "https://api.scraperapi.com/structured/redfin/property/v1",
] as const;

/** A month: a listing's photos don't change once it's posted. */
export const LISTING_REVALIDATE_SECONDS = 2_592_000;

/** Anything that looks like an image URL, wherever it sits.
 *  Schema-independent on purpose: photo arrays get renamed, but a JPEG
 *  link is recognisable whatever key holds it. */
const IMAGE_URL = /^https?:\/\/[^\s"']+\.(?:jpe?g|png|webp|avif)(?:\?[^\s"']*)?$/i;
const REDFIN_CDN = /(?:ssl\.cdn-redfin\.com|redfin\.com)\/[^\s"']+\.(?:jpe?g|png|webp)/i;

export function harvestPhotos(
  value: unknown,
  depth = 0,
  out: string[] = []
): string[] {
  if (depth > 8 || out.length >= 40) return out;
  if (typeof value === "string") {
    if (IMAGE_URL.test(value) || REDFIN_CDN.test(value)) {
      if (!out.includes(value)) out.push(value);
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) harvestPhotos(v, depth + 1, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Row)) harvestPhotos(v, depth + 1, out);
  }
  return out;
}

export interface RedfinListingDetail {
  photos: string[];
  /** Which candidate path answered — pin it once known. */
  endpoint: string | null;
  credits: number | null;
  /** Raw payload, for the shape probe only. */
  body: unknown;
}

/**
 * One listing's page, for its full gallery.
 *
 * Called only when a student opens a listing, never while browsing a
 * list — a page of twenty-four cards must not become twenty-four billed
 * requests. Cached a month per listing and shared by everyone.
 */
export async function fetchRedfinListing(
  listingUrl: string
): Promise<RedfinListingDetail> {
  const key = process.env.SCRAPERAPI_KEY;
  if (!key) throw new RedfinError("no-key");
  if (!/^https:\/\/(?:www\.)?redfin\.com\//i.test(listingUrl)) {
    // Only ever fetch Redfin's own pages: this URL arrives from the
    // client, and an open fetcher would proxy anything asked of it.
    throw new RedfinError("http", 400, "not a redfin.com listing URL");
  }

  let lastDetail = "";
  for (const endpoint of REDFIN_LISTING_ENDPOINTS) {
    const params = new URLSearchParams({ api_key: key, url: listingUrl });
    let res: Response;
    try {
      res = await fetch(`${endpoint}?${params}`, {
        next: { revalidate: LISTING_REVALIDATE_SECONDS },
      });
    } catch {
      throw new RedfinError("network");
    }

    if (res.status === 401) throw new RedfinError("auth", 401);
    if (res.status === 429) throw new RedfinError("quota", 429);
    if (!res.ok) {
      // A wrong path 404s; keep trying the others rather than give up.
      lastDetail = (await res.text().catch(() => ""))
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      continue;
    }

    const body: unknown = await res.json().catch(() => null);
    return {
      photos: harvestPhotos(body),
      endpoint,
      credits: creditsFrom(res),
      body,
    };
  }

  throw new RedfinError("http", 404, lastDetail || "no listing endpoint answered");
}

/* ------------------------------------------------------------------ */
/* Fetch                                                               */
/* ------------------------------------------------------------------ */

export interface RedfinFetch {
  listings: RentalListing[];
  /** Rows our extractor found, for the shape probe only. */
  raw: Row[];
  /** Why unusable rows were dropped, by reason. */
  skipped: Record<string, number>;
  /** Which geocoder placed the rows we kept. */
  geocodedBy: Record<string, number>;
  /** How many pages were read, and whether more were left. */
  pages: number;
  morePages: boolean;
  /** The WHOLE parsed response. A probe that only ever sees the rows we
   *  already extracted cannot explain an extraction that found none. */
  body: unknown;
  /** False when the response wasn't JSON at all. */
  parsed: boolean;
  bytes: number;
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
/** One page of results, exactly as the vendor returns it. */
async function fetchPage(pageUrl: string): Promise<{
  body: unknown;
  rows: Row[];
  parsed: boolean;
  bytes: number;
  credits: number | null;
}> {
  const key = process.env.SCRAPERAPI_KEY;
  if (!key) throw new RedfinError("no-key");

  // Exactly the parameters ScraperAPI's own snippet sends. Extras that
  // "shouldn't hurt" are how a working request quietly stops working.
  const params = new URLSearchParams({ api_key: key, url: pageUrl });

  let res: Response;
  try {
    res = await fetch(`${REDFIN_SEARCH_ENDPOINT}?${params}`, {
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

  const text = await res.text();
  let body: unknown = null;
  let parsed = true;
  try {
    body = JSON.parse(text);
  } catch {
    parsed = false;
  }
  return {
    body,
    rows: extractListings(body),
    parsed,
    bytes: text.length,
    credits: creditsFrom(res),
  };
}

/**
 * Every page of rentals for one market, optionally furnished only.
 *
 * Follows Redfin's own next-page links up to the cap: the first page is
 * about 41 rows, so stopping there shows a third of a market and reads
 * as a narrower search than the one that ran.
 */
export async function fetchRedfinRentals(
  market: Market,
  opts: { furnished?: boolean } = {}
): Promise<RedfinFetch> {
  const searchUrl = redfinRentalsUrl(market, opts);
  if (!searchUrl) throw new RedfinError("no-city");

  const limit = maxPages();
  const seen = new Set<string>([searchUrl]);
  const queue = [searchUrl];
  const raw: Row[] = [];
  let body: unknown = null;
  let parsed = true;
  let bytes = 0;
  let credits: number | null = null;
  let pages = 0;

  while (queue.length > 0 && pages < limit) {
    const pageUrl = queue.shift()!;
    const page = await fetchPage(pageUrl);
    pages += 1;
    raw.push(...page.rows);
    bytes += page.bytes;
    if (page.credits !== null) credits = (credits ?? 0) + page.credits;
    // Diagnostics describe the FIRST page; later ones share its shape.
    if (pages === 1) {
      body = page.body;
      parsed = page.parsed;
    }
    for (const next of nextPageUrls(page.body)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  const furnished = Boolean(opts.furnished);
  const skipped: Record<string, number> = {};
  const geocodedBy: Record<string, number> = {};
  const listings: RentalListing[] = [];

  // Redfin's search rows carry no coordinates, so every address is
  // placed before it can be shown. Cached 30 days per address, so a
  // market costs this once and every student after that rides it free.
  const points = await geocodeAll(
    raw.map((row) => {
      const line = pickString(row, ADDRESS_KEYS) ?? "";
      // Census wants a complete one-line address; Redfin's already
      // carries city and state, but a bare street needs help.
      return /,/.test(line) ? line : `${line}, ${market.name}, ${market.stateCode}`;
    })
  );

  raw.forEach((row, index) => {
    const found = points[index];
    if (found?.source) {
      geocodedBy[found.source] = (geocodedBy[found.source] ?? 0) + 1;
    }
    const result = mapRedfinListing(row, market, {
      furnished,
      index,
      coords: found?.point ?? undefined,
    });
    if (result.ok) listings.push(result.listing);
    else skipped[result.skip] = (skipped[result.skip] ?? 0) + 1;
  });
  listings.sort((a, b) => a.rentMonthly - b.rentMonthly);

  return {
    listings,
    raw,
    skipped,
    geocodedBy,
    pages,
    morePages: queue.length > 0,
    body,
    parsed,
    bytes,
    credits,
    searchUrl,
  };
}
