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

import { addressKey, buildingKey, streetPartOf } from "@/lib/live/address";
import { withScraperSlot } from "@/lib/live/limit";
import { mineFeatures } from "@/lib/live/features";
import { geocodeAll } from "@/lib/live/geocode";
import { cityIdFor, REDFIN_CITY_ID } from "@/lib/live/redfin-city";
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

/**
 * Pages to read when the point is photos rather than listings.
 *
 * Separate from the search depth because it buys a different thing.
 * Coverage here is bounded by how many rows the photo source returns
 * against a feed that returns far more, so every extra page is more
 * rows that can match — and pages after the first go in parallel, so
 * it costs credits rather than time.
 *
 * Left at the search default until someone chooses otherwise: this is
 * a per-market-per-day cost on somebody's plan, not a free dial.
 * REDFIN_PHOTO_PAGES turns it up; the diagnostic reports what it buys.
 */
function photoPages(): number {
  const raw = Number(process.env.REDFIN_PHOTO_PAGES);
  return Number.isFinite(raw) && raw > 0 ? maxPages(raw) : maxPages();
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
  const city = market.name.trim().replace(/\s+/g, "-");
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
/**
 * Which URL form actually filters the rentals search to houses.
 *
 * This has to be measured rather than reasoned about. A filter segment
 * the vendor doesn't recognise is not rejected — it is ignored, and the
 * search answers with its default result set. That is indistinguishable
 * from success by row count, which is exactly how a "house pass" came
 * to return 166 apartment rows and report them as a win.
 *
 * So: one page of each candidate, side by side with one page of the
 * unfiltered search, and the answer is whichever form returns something
 * DIFFERENT. Deliberately behind a query flag — it costs a handful of
 * requests and nobody should pay for it on a page load.
 */
export async function probeHouseFilters(market: Market): Promise<unknown> {
  const cityId = REDFIN_CITY_ID[market.slug];
  if (cityId === undefined) {
    return { market: market.slug, error: "no city id for this market" };
  }

  const city = market.name.trim().replace(/\s+/g, "-");
  const base = `https://www.redfin.com/city/${cityId}/${market.stateCode}/${city}`;
  const candidates: { label: string; url: string }[] = [
    { label: "unfiltered (control)", url: `${base}/rentals` },
    { label: "filter/property-type=house", url: `${base}/rentals/filter/property-type=house` },
    { label: "filter/property-type=house,townhouse", url: `${base}/rentals/filter/property-type=house,townhouse` },
    { label: "filter/propertyType=house", url: `${base}/rentals/filter/propertyType=house` },
    { label: "filter/property-type=single-family", url: `${base}/rentals/filter/property-type=single-family` },
    { label: "houses-for-rent", url: `${base}/houses-for-rent` },
    { label: "apartments-for-rent", url: `${base}/apartments-for-rent` },
  ];

  const results = await Promise.all(
    candidates.map(async ({ label, url }) => {
      try {
        const page = await fetchPage(url);
        const addresses = page.rows
          .map((row) => pickString(row, ADDRESS_KEYS))
          .filter((a): a is string => Boolean(a));
        return {
          label,
          url,
          rows: page.rows.length,
          parsed: page.parsed,
          // The tell: a community name before a pipe is a managed
          // apartment block, and a house never has one.
          piped: addresses.filter((a) => a.includes("|")).length,
          sample: addresses.slice(0, 5),
        };
      } catch (error) {
        return {
          label,
          url,
          rows: 0,
          error: error instanceof RedfinError ? error.reason : "failed",
        };
      }
    })
  );

  const control = results[0];
  return {
    market: market.slug,
    results,
    verdict:
      "Compare each candidate's `sample` and `piped` against the control. " +
      "A form that filters shows FEWER piped addresses and different " +
      "streets; a form the vendor ignores looks identical to the control " +
      `(rows ${control.rows}, piped ${"piped" in control ? control.piped : "?"}).`,
  };
}

export interface RedfinPhotoIndex {
  /** Every photo-bearing row, raw and deduped, ready to become shown
   *  listings via mapRedfinRows. Raw on purpose: mapping means
   *  geocoding, seconds per cold address, and the CALLER knows which
   *  rows will survive its dedup — placing the rest is how the biggest
   *  market's photo pass outran its time budget and answered with
   *  nothing at all. */
  rows: Row[];
  /** Address → photo, exact. Consulted first. */
  index: Map<string, string>;
  /** Building → photo, for a flat in a block photographed once. Kept
   *  apart from the exact map rather than merged into it: one shared
   *  map with first-writer-wins meant a building entry could shadow the
   *  unit's own photo, which is the opposite of the stated rule. */
  buildings: Map<string, string>;
  /** Where the rows went, so a thin index can be explained rather than
   *  guessed at. The first cut of this returned five keys for a city
   *  and there was no way to see which step lost them. */
  stats: {
    pages: number;
    rows: number;
    withAddress: number;
    withPhoto: number;
    /** Rows the house pass contributed. Zero here with a healthy
     *  default pass means the property-type filter is not biting and
     *  the URL form needs changing — not that the city has no houses. */
    housePassRows: number;
    /** Distinct keys the house pass ADDED. A filter Redfin ignores does
     *  not come back empty — it comes back with the default result set,
     *  which reads as success from a row count alone. This is the number
     *  that tells the two apart. */
    housePassNewKeys: number;
    /** Why a house pass died, when one did. The throttle was silently
     *  eaten by a catch and reported as "no houses" until this. */
    housePassError: string | null;
    /** Pages lost to throttling or network across all passes. */
    failedPages: number;
    /** True when the page cap stopped us rather than the vendor running
     *  out of results. */
    morePages: boolean;
    /** The URL the house pass asked for, so a filter that Redfin
     *  ignores can be read rather than inferred from a zero. */
    housePassUrl: string | null;
    /** Raw, as the vendor wrote them — the pipe-separated community
     *  names only became visible once these were printed. */
    sampleAddresses: string[];
    /** The house pass's OWN rows. Kept separate because the last probe
     *  read the merged list and could not see that the house pass was
     *  serving apartment communities. */
    houseSampleAddresses: string[];
  };
}

/**
 * Two passes, because the default search is nearly all apartments.
 *
 * A city's rentals search comes back dominated by managed communities —
 * Cedar Creek Villas, Riverbank Apartments — while the feed we are
 * matching against is mostly single-family houses. Four pages of the
 * default view produced 164 rows and matched twelve, and every row it
 * failed to match was a house. Paging deeper would have bought more
 * apartments.
 *
 * So the second pass asks for houses specifically. It is additive and
 * failure is harmless: a filter that doesn't bite returns nothing, the
 * default pass still stands, and housePassRows says which happened.
 */
/**
 * Extra passes, one property type each.
 *
 * Houses by default because that is what the feed is made of and what
 * the default search never surfaces. REDFIN_PHOTO_TYPES adds more —
 * "house,townhouse" runs TWO passes, not one two-valued filter.
 */
function photoTypes(): string[] {
  const raw = process.env.REDFIN_PHOTO_TYPES;
  if (!raw) return ["house"];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export async function fetchRedfinPhotoIndex(
  market: Market
): Promise<RedfinPhotoIndex> {
  const index = new Map<string, string>();
  const buildings = new Map<string, string>();
  const stats = {
    pages: 0,
    rows: 0,
    withAddress: 0,
    withPhoto: 0,
    housePassRows: 0,
    housePassNewKeys: 0,
    housePassError: null as string | null,
    failedPages: 0,
    morePages: false,
    housePassUrl: null as string | null,
    sampleAddresses: [] as string[],
    houseSampleAddresses: [] as string[],
  };
  // Seeded ids only. Photos are decoration, and resolving an unknown id
  // costs two proxy round trips before it can even fail — latency spent
  // on the one part of the row a student can do without.
  if (!redfinCoversMarket(market))
    return { rows: [], index, buildings, stats };

  const pages = photoPages();
  const [everything, ...typed] = await Promise.all([
    fetchRedfinRentals(market, { furnished: false, map: false, pages }),
    // A narrower pass must not sink the search it supplements — but its
    // failure gets NAMED, not eaten. A bare catch here reported a
    // vendor throttle as "this city has no houses".
    ...photoTypes().map((propertyType) =>
      fetchRedfinRentals(market, {
        furnished: false,
        map: false,
        pages,
        propertyType,
      }).catch((error: unknown) => {
        const reason =
          error instanceof RedfinError ? error.reason : "failed";
        stats.housePassError = stats.housePassError
          ? `${stats.housePassError}, ${propertyType}: ${reason}`
          : `${propertyType}: ${reason}`;
        return null;
      })
    ),
  ]);
  const houses = typed.filter((r) => r !== null);

  const houseRows = houses.flatMap((h) => h.raw);
  stats.pages = everything.pages + houses.reduce((n, h) => n + h.pages, 0);
  stats.housePassRows = houseRows.length;
  stats.housePassUrl = houses.map((h) => h.searchUrl).join(" | ") || null;
  stats.morePages =
    everything.morePages || houses.some((h) => h.morePages);
  stats.failedPages =
    everything.failedPages + houses.reduce((n, h) => n + h.failedPages, 0);

  const absorb = (rows: readonly Row[], samples: string[]) => {
    for (const row of rows) {
      stats.rows += 1;
      const address = pickString(row, ADDRESS_KEYS);
      // Some rows carry the thumbnail somewhere the key list doesn't
      // name; harvesting finds an image URL wherever it sits.
      const photo = pickString(row, PHOTO_KEYS) ?? harvestPhotos(row)[0];
      if (address) {
        stats.withAddress += 1;
        if (samples.length < 8) samples.push(address);
      }
      if (photo) stats.withPhoto += 1;
      if (!address || !photo) continue;
      const key = addressKey(address);
      if (key && !index.has(key)) index.set(key, photo);
      const building = buildingKey(address);
      if (building && !buildings.has(building)) buildings.set(building, photo);
    }
  };

  // The default pass first, so the house pass's contribution can be
  // counted rather than assumed.
  absorb(everything.raw, stats.sampleAddresses);
  const beforeHouses = index.size;
  absorb(houseRows, stats.houseSampleAddresses);
  stats.housePassNewKeys = index.size - beforeHouses;

  // The passes overlap — a house on page one of both is one row. Keyed
  // by listing URL where there is one, address otherwise.
  const byKey = new Map<string, Row>();
  for (const row of [...everything.raw, ...houseRows]) {
    const address = pickString(row, ADDRESS_KEYS);
    const photo = pickString(row, PHOTO_KEYS) ?? harvestPhotos(row)[0];
    if (!address || !photo) continue;
    const key = pickString(row, URL_KEYS) ?? address;
    if (!byKey.has(key)) byKey.set(key, row);
  }

  return { rows: [...byKey.values()], index, buildings, stats };
}

/* ------------------------------------------------------------------ */
/* One listing's full gallery                                          */
/* ------------------------------------------------------------------ */

/** Pinned against a live listing: 10 credits, and far more than photos —
 *  a description, structured amenities, and deposit ranges. */
export const REDFIN_LISTING_ENDPOINT =
  "https://api.scraperapi.com/structured/redfin/forrent/v1";

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

/** Where a listing page keeps its amenity labels. */
const AMENITY_PATHS = [
  ["amenities", "unit_amenities"],
  ["amenities", "community_amenities"],
  ["amenities", "standardized_amenities"],
  ["amenities", "other_amenities"],
] as const;

/** Short factual labels — "In-unit washer & dryer", "Air conditioning" —
 *  not prose. Deduped, order preserved. */
export function harvestAmenities(body: unknown): string[] {
  const out: string[] = [];
  const add = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const v of value) {
      const label = typeof v === "string" ? v.trim() : "";
      if (label && !out.includes(label)) out.push(label);
    }
  };
  const root = (body ?? {}) as Row;
  for (const [group, key] of AMENITY_PATHS) {
    const bucket = root[group];
    if (bucket && typeof bucket === "object") add((bucket as Row)[key]);
  }
  // Floor plans carry their own unit-specific list.
  const plans = root.floor_plans;
  if (Array.isArray(plans)) {
    for (const plan of plans) {
      const unit = (plan as Row)?.unit_type as Row | undefined;
      add(unit?.specific_amenities);
    }
  }
  return out;
}

export interface RedfinListingDetail {
  photos: string[];
  /** Redfin's own amenity labels for this unit and its building. */
  amenities: string[];
  /** Our canonical tags, mined from those labels and the listing's
   *  description through the one shared miner — so "Furnished" means
   *  the same thing here as everywhere else, negations included. */
  features: string[];
  /** Security deposit, when the page publishes one — a real calculator
   *  input the analyzer currently defaults to zero. */
  depositMin?: number;
  depositMax?: number;
  credits: number | null;
  /** Raw payload, for the shape probe only. */
  body: unknown;
}

/**
 * One listing's page: its photos, its amenities, its deposit.
 *
 * Called only when a student opens a listing, never while browsing a
 * list — a page of twenty-four cards must not become twenty-four billed
 * requests. Cached a month per listing and shared by everyone.
 *
 * The payload also carries the listing's own description. It is mined
 * for tags and goes no further: the product shows facts about a
 * property, not somebody else's paragraph about it.
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

  const params = new URLSearchParams({ api_key: key, url: listingUrl });
  let res: Response;
  try {
    res = await withScraperSlot(() =>
      fetch(`${REDFIN_LISTING_ENDPOINT}?${params}`, {
        next: { revalidate: LISTING_REVALIDATE_SECONDS },
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
      .slice(0, 200);
    if (res.status === 401) throw new RedfinError("auth", 401, detail);
    if (res.status === 403) throw new RedfinError("forbidden", 403, detail);
    if (res.status === 429) throw new RedfinError("quota", 429, detail);
    throw new RedfinError("http", res.status, detail);
  }

  const body: unknown = await res.json().catch(() => null);
  const root = (body ?? {}) as Row;
  const amenities = harvestAmenities(body);
  const fees = root.fees_and_policies as Row | undefined;
  const num = (v: unknown) => (typeof v === "number" && v >= 0 ? v : undefined);

  return {
    photos: harvestPhotos(body),
    amenities,
    features:
      mineFeatures([...amenities, pickString(root, ["description"])]) ?? [],
    depositMin: num(fees?.deposit_fee_min),
    depositMax: num(fees?.deposit_fee_max),
    credits: creditsFrom(res),
    body,
  };
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
/** The address a raw search row carries, wherever the vendor put it. */
export function redfinAddressOf(row: Row): string | null {
  return pickString(row, ADDRESS_KEYS) ?? null;
}

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
