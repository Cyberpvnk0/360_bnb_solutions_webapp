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
 * THAT IS ALL IT DOES. One fact — furnished or not — plus the listing
 * details the same search row carries (address, rent, beds, the page
 * URL). No photos. Not welded onto rows, not fetched from listing
 * pages, not stored. A listing photo is copyrighted separately from the
 * facts around it and this product holds no licence to display one;
 * the card links to the listing's own page instead, where the photos
 * already live under someone else's licence.
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

import { streetPartOf } from "@/lib/live/address";
import { withScraperSlot } from "@/lib/live/limit";
import { mineFeatures } from "@/lib/live/features";
import { geocodeAll } from "@/lib/live/geocode";
import { cityIdFor, REDFIN_CITY_ID, REDFIN_CITY_PATH } from "@/lib/live/redfin-city";
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

/** Hard ceiling. Raised from ten once coverage, not latency, became
 *  the binding constraint — pages go in parallel waves now. */
const PAGE_CEILING = 25;

function maxPages(override?: number): number {
  const raw = override ?? Number(process.env.REDFIN_MAX_PAGES);
  return Number.isFinite(raw) && raw > 0
    ? Math.min(PAGE_CEILING, Math.floor(raw))
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
 * A Redfin rentals search URL for a KNOWN city id, optionally narrowed
 * to furnished units. Mirrors the real URL shape:
 *   /city/8907/FL/Jacksonville/rentals/filter/is-furnished
 */
export function redfinRentalsUrlFor(
  market: Market,
  cityId: number,
  opts: { furnished?: boolean; propertyType?: string } = {}
): string {
  // The site files a few cities under another name — Berkeley Springs
  // as Bath, Augusta as Augusta-Richmond — so the path is an override
  // where one exists and the market's own name everywhere else.
  const city =
    REDFIN_CITY_PATH[market.slug] ?? market.name.trim().replace(/\s+/g, "-");
  const base = `https://www.redfin.com/city/${cityId}/${market.stateCode}/${city}/rentals`;
  // Filters stack behind one /filter/ segment, comma separated.
  //
  // ONE property type. A live probe measured "property-type=house"
  // returning real houses and "property-type=house,townhouse" returning
  // the unfiltered set — the second value doesn't widen the filter, it
  // silently voids it, and an ignored filter looks exactly like a
  // working one from a row count. Several types means several passes,
  // never one comma-joined value, so the broken form can't be built.
  const filters: string[] = [];
  if (opts.furnished) filters.push("is-furnished");
  if (opts.propertyType) filters.push(`property-type=${opts.propertyType}`);
  return filters.length > 0 ? `${base}/filter/${filters.join(",")}` : base;
}

/**
 * The same URL, resolving the market's city id first — from the seeded
 * map when we have it, otherwise from Redfin's own autocomplete, and
 * null when we can't be sure. Null is a real answer: searching a city we
 * merely hope is right would show another metro's rentals under this
 * market's name.
 */
export async function redfinRentalsUrl(
  market: Market,
  opts: { furnished?: boolean; propertyType?: string } = {}
): Promise<string | null> {
  const cityId = await cityIdFor(market);
  return cityId === null ? null : redfinRentalsUrlFor(market, cityId, opts);
}

/** Whether this market has a Redfin city id without going and asking. */
export function redfinCoversMarket(market: Market): boolean {
  return REDFIN_CITY_ID[market.slug] !== undefined;
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
      /** The scraping plan's credits are spent for this cycle. Its own
       *  reason because the vendor answers 403 for it, and "forbidden"
       *  sends whoever reads the log hunting for a blocked domain or a
       *  bad key instead of a billing page. */
      | "no-credits"
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
      // The street, not "Community Name | Street" — the marketing name
      // reads as noise on a card and wrecks address joins.
      address: streetPartOf(address),
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
  /** Pages lost mid-pass (throttle, network) rather than absent. */
  failedPages: number;
  /** The WHOLE parsed response. A probe that only ever sees the rows we
   *  already extracted cannot explain an extraction that found none. */
  body: unknown;
  /** False when the response wasn't JSON at all. */
  parsed: boolean;
  bytes: number;
  credits: number | null;
  searchUrl: string;
}

/**
 * Whether a refusal is really the plan running dry.
 *
 * The vendor says 403 for this, the same status it uses for a domain
 * it won't fetch — so the body is the only thing that tells them
 * apart, and they need opposite responses: one is a code problem, the
 * other is a billing page.
 */
export function looksSpent(detail: string): boolean {
  return /exhausted the API Credits|out of credits|upgrade your (plan|subscription)/i.test(
    detail
  );
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
    // Through the shared gate: the vendor meters requests IN FLIGHT,
    // and two paginated passes running their waves side by side is how
    // one of them came back 429 and read as "no houses".
    res = await withScraperSlot(() =>
      fetch(`${REDFIN_SEARCH_ENDPOINT}?${params}`, {
        next: { revalidate: REDFIN_REVALIDATE_SECONDS },
      })
    );
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
    if (res.status === 403) {
      throw new RedfinError(
        looksSpent(detail) ? "no-credits" : "forbidden",
        403,
        detail
      );
    }
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

/**
 * Raw search rows to shown listings: place, map, sort.
 *
 * Its own function so a caller can choose WHICH rows earn the work.
 * Geocoding is the expensive step — Redfin's rows carry no coordinates,
 * so every address goes to the Census geocoder, seconds each on a cold
 * cache — and placing three hundred rows to then discard half as
 * duplicates is how the biggest market's photo pass outran its whole
 * time budget and answered with nothing.
 *
 * Cached 30 days per address, so a market pays this once and every
 * student after that rides it free.
 */
export async function mapRedfinRows(
  raw: readonly Row[],
  market: Market,
  opts: { furnished: boolean }
): Promise<{
  listings: RentalListing[];
  skipped: Record<string, number>;
  geocodedBy: Record<string, number>;
}> {
  const skipped: Record<string, number> = {};
  const geocodedBy: Record<string, number> = {};
  const listings: RentalListing[] = [];

  const points = await geocodeAll(
    raw.map((row) => {
      const line = pickString(row, ADDRESS_KEYS) ?? "";
      // Census wants a complete one-line address; Redfin's already
      // carries city and state, but a bare street needs help.
      return /,/.test(line)
        ? line
        : `${line}, ${market.name}, ${market.stateCode}`;
    })
  );

  raw.forEach((row, index) => {
    const found = points[index];
    if (found?.source) {
      geocodedBy[found.source] = (geocodedBy[found.source] ?? 0) + 1;
    }
    const result = mapRedfinListing(row, market, {
      furnished: opts.furnished,
      index,
      coords: found?.point ?? undefined,
    });
    if (result.ok) listings.push(result.listing);
    else skipped[result.skip] = (skipped[result.skip] ?? 0) + 1;
  });
  listings.sort((a, b) => a.rentMonthly - b.rentMonthly);
  return { listings, skipped, geocodedBy };
}

export async function fetchRedfinRentals(
  market: Market,
  opts: {
    furnished?: boolean;
    /** Set false to skip geocoding and mapping and return only the raw
     *  rows. */
    map?: boolean;
    /** Override the page ceiling for this call. */
    pages?: number;
    /** Narrow to ONE property type, e.g. "house". Never a list — see
     *  redfinRentalsUrlFor. */
    propertyType?: string;
  } = {}
): Promise<RedfinFetch> {
  const searchUrl = await redfinRentalsUrl(market, opts);
  if (!searchUrl) throw new RedfinError("no-city");

  const limit = maxPages(opts.pages);
  const raw: Row[] = [];
  let bytes = 0;
  let credits: number | null = null;

  // Breadth-first, a wave at a time. Walking pages one by one made a
  // search cost its whole page count end to end; taking only the links
  // the FIRST page happened to list caps the depth wherever the vendor
  // shows a window of page numbers rather than all of them. Waves keep
  // the parallelism and keep discovering.
  const seen = new Set<string>([searchUrl]);
  let queue = [searchUrl];
  let body: unknown = null;
  let parsed = true;
  let pages = 0;
  const failed: string[] = [];

  const absorbPage = (page: Awaited<ReturnType<typeof fetchPage>>) => {
    pages += 1;
    raw.push(...page.rows);
    bytes += page.bytes;
    if (page.credits !== null) credits = (credits ?? 0) + page.credits;
    // Diagnostics describe the FIRST page; later ones share its shape.
    if (body === null) {
      body = page.body;
      parsed = page.parsed;
    }
    for (const next of nextPageUrls(page.body)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  };

  while (queue.length > 0 && pages < limit) {
    const wave = queue.slice(0, limit - pages);
    queue = queue.slice(wave.length);
    const settled = await Promise.allSettled(wave.map((url) => fetchPage(url)));
    // The OPENING page failing is the search failing — surface why.
    // A later page lost to a throttle costs its rows, not the pass:
    // all-or-nothing here is how one 429 turned into "no houses".
    if (pages === 0 && settled.every((r) => r.status === "rejected")) {
      throw (settled[0] as PromiseRejectedResult).reason;
    }
    settled.forEach((result, i) => {
      if (result.status === "rejected") failed.push(wave[i]);
      else absorbPage(result.value);
    });
  }

  // One patient retry for what the throttle ate. It refuses a burst,
  // not a grudge: a page it bounced a moment ago usually loads on the
  // second ask, a failed request is never billed, and a live probe
  // showed five of thirteen pages lost this way — rows already paid
  // for in latency and abandoned.
  if (failed.length > 0 && pages < limit) {
    const retrying = failed.splice(0, limit - pages);
    const settled = await Promise.allSettled(
      retrying.map((url) => fetchPage(url))
    );
    settled.forEach((result, i) => {
      if (result.status === "rejected") failed.push(retrying[i]);
      else absorbPage(result.value);
    });
  }
  const failedPages = failed.length;
  // Pages we failed to read still exist, so a lossy pass reports both.
  const morePages = queue.length > 0 || failedPages > 0;
  const furnished = Boolean(opts.furnished);
  const mapped =
    opts.map === false
      ? { listings: [], skipped: {}, geocodedBy: {} }
      : await mapRedfinRows(raw, market, { furnished });
  const { listings, skipped, geocodedBy } = mapped;

  return {
    listings,
    raw,
    skipped,
    geocodedBy,
    pages,
    morePages,
    failedPages,
    body,
    parsed,
    bytes,
    credits,
    searchUrl,
  };
}
