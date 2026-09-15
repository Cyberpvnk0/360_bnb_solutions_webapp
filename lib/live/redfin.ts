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

import { zipFromAddress } from "./zip";
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
 * How hard the supplier is asked to try on redfin.com.
 *
 * `premium` by default because the supplier refuses the domain without
 * it — see the request builder below. Each tier is several times the
 * price of the one before, so this is the one knob between "the
 * furnished search works" and "the furnished search is affordable",
 * and it belongs in the environment rather than in a constant.
 */
export const SCRAPE_TIER_PARAMS = {
  standard: {},
  premium: { premium: "true" },
  ultra: { ultra_premium: "true" },
} as const;

export type RedfinScrapeTier = keyof typeof SCRAPE_TIER_PARAMS;

export function redfinScrapeTier(): RedfinScrapeTier {
  const raw = process.env.REDFIN_SCRAPE_TIER?.trim();
  return raw && raw in SCRAPE_TIER_PARAMS ? (raw as RedfinScrapeTier) : "premium";
}


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

export function maxPages(override?: number): number {
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
 * The site's rentals search for one ZIP, in the two shapes the site
 * writes it: the path the city search uses, then the older slug. No id
 * to resolve — the ZIP is the path. The fast way from an address to
 * its page: a ZIP is a few pages where a city is dozens. See
 * lib/live/zip-pages, which tries them in order.
 */
export function zipRentalsUrls(zip: string): string[] {
  return [
    `https://www.redfin.com/zipcode/${zip}/rentals`,
    `https://www.redfin.com/zipcode/${zip}/apartments-for-rent`,
  ];
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

/**
 * Every reason a fetch here can fail — as a VALUE, not only a type.
 *
 * The browser has its own copy of this list (lib/data/redfin) and turns
 * each one into a sentence a member reads. When the two drifted apart,
 * the sentence for the missing reason silently became the catch-all:
 * a scraping plan out of credits reported itself on screen as
 * "Furnished search unreachable", which sent the reader to check their
 * connection over a billing problem. Exported as an array so a test can
 * walk it and refuse the drift rather than trusting two hand-written
 * unions to stay equal.
 */
export const REDFIN_REASONS = [
  "no-key",
  "no-city",
  "auth",
  "forbidden",
  "quota",
  /** The scraping plan's credits are spent for this cycle. Its own
   *  reason because the vendor answers 403 for it, and "forbidden"
   *  sends whoever reads the log hunting for a blocked domain or a bad
   *  key instead of a billing page. */
  "no-credits",
  /** The supplier refuses redfin.com on the tier we asked for and names
   *  the parameter it wants. Its own reason because it is a settings
   *  fix, not an outage — and because for a while its wording was being
   *  read as "this city has no rentals page", which made every market
   *  in the product report no furnished inventory. */
  "needs-premium",
  /** We reached them and they were too slow. Its own reason because
   *  "network" reads as "we could not reach them", and this is worth
   *  retrying where that is not. */
  "timeout",
  "http",
  "network",
] as const;

export type RedfinReason = (typeof REDFIN_REASONS)[number];

/** Why a Redfin fetch failed, in words the UI can show. */
export class RedfinError extends Error {
  constructor(
    readonly reason: RedfinReason,
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
/**
 * The FIRST number in one of their display strings.
 *
 * Their rental rows are mostly apartment complexes, and a complex
 * describes itself as a range: "420-1,050 sq ft", "1-3 beds",
 * "1.5-2.5 baths". Stripping every non-digit and reading what is left
 * turns the first of those into four million two hundred and one
 * thousand and fifty square feet, which is what a card was showing.
 *
 * The low end is the honest reading, and it is the one that agrees
 * with the rest of the row: the price on a complex is its "from"
 * price, so the smallest floor plan and the cheapest rent belong
 * together. Reporting the range's top with the range's bottom price
 * would describe a unit that does not exist.
 */
function pickNumber(row: Row, keys: readonly string[]): number | undefined {
  const raw = pick(row, keys);
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    // A digit, then digits and commas, then optionally a decimal tail —
    // so "1,050" survives whole and "420-1,050" stops at the dash.
    const first = raw.match(/\d[\d,]*(?:\.\d+)?/)?.[0];
    if (first === undefined) return undefined;
    const cleaned = Number(first.replace(/,/g, ""));
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

/** The listing's own page, absolute. Shared by the mapper and the join
 *  index so the two can never disagree about where a row points. */
function detailUrlOf(row: Row): string | undefined {
  const detail = pickString(row, URL_KEYS);
  if (!detail) return undefined;
  return detail.startsWith("http")
    ? detail
    : `https://www.redfin.com${detail.startsWith("/") ? "" : "/"}${detail}`;
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
const ZIP_KEYS = ["zip", "zipCode", "postalCode", "zip_code", "postal_code"] as const;
const TYPE_KEYS = ["propertyType", "homeType"] as const;
/** Short display chips beside a listing — a second amenity signal. */
const FACTS_KEYS = ["key_facts", "keyFacts", "facts", "badge"] as const;

/**
 * NO CONTACT IN A SEARCH ROW, AND THIS IS THE RECORD OF THAT.
 *
 * A shape probe over 164 Jacksonville rentals found no agent name, no
 * broker name and no email anywhere in the response. There IS a
 * `phone` field, on every single row, and it is the empty string on
 * every single one — a slot in their schema that their search never
 * fills.
 *
 * So the speculative alias list that used to sit here has been
 * deleted rather than left as decoration, which is what the probe was
 * run to decide. Contact for a rental has to come from the listing
 * PAGE or from a data vendor; it cannot come from this endpoint, and
 * a future reader should not spend an afternoon re-deriving that.
 */


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

function propertyTypeOf(row: Row): { type: PropertyType; known: boolean } {
  const raw = pickString(row, TYPE_KEYS)?.toLowerCase();
  const mapped = raw ? TYPE_MAP[raw] : undefined;
  // Redfin's rental inventory is apartment-heavy; that is the stand-in
  // when the feed doesn't say — for FILTERING only. A card never prints
  // a type the feed did not state.
  return mapped ? { type: mapped, known: true } : { type: "apartment", known: false };
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
      // Their own field when they send one, else the postal tail of the
      // address — either lets a ZIP search cut a city's furnished set
      // down to the ZIP that was typed.
      ...(() => {
        const zip = pickString(raw, ZIP_KEYS) ?? zipFromAddress(address ?? undefined);
        return zip && /^\d{5}$/.test(zip) ? { zip } : {};
      })(),
      marketSlug: market.slug,
      lat,
      lon,
      bedrooms,
      bathrooms,
      sqft: Math.round(pickNumber(raw, SQFT_KEYS) ?? 0),
      propertyType: propertyTypeOf(raw).type,
      propertyTypeKnown: propertyTypeOf(raw).known,
      rentMonthly: Math.round(rentMonthly),
      // Redfin's search rows carry no listing date. Left absent rather
      // than zeroed, which would badge all eighty "New, listed today".
      daysOnMarket: pickNumber(raw, ["daysOnMarket", "dom"]),
      // The listing's own page: what "View photos" links to. Nothing
      // here opens it — the photos stay on the site that published them.
      sourceUrl: detailUrlOf(raw),
      petFriendly: features.includes("Pet friendly"),
      features,
      // A furnished-filtered search is a real amenity answer; the chips
      // alone are not enough to claim we know the full picture.
      featuresKnown: opts.furnished,
    },
  };
}

/**
 * Address and listing page, straight off the raw rows.
 *
 * WHAT THE JOIN ACTUALLY NEEDS, AND NOTHING ELSE. lib/live/listing-join
 * matches a feed row to its published page by address; it never touches
 * coordinates, beds, baths or rent. Running the full mapper to get here
 * was paying three prices for facts it then discarded:
 *
 *   MONEY. The mapper geocodes every row, because a row that will be
 *   PLOTTED needs a point. At roughly five hundred rows a market that
 *   is a couple of dollars of geocoding per market per day, for
 *   coordinates the join throws away.
 *
 *   TIME. Geocoding is the slow step by a wide margin, and it sat in
 *   the request path.
 *
 *   COVERAGE, which is the one that actually hurt. The mapper DROPS a
 *   row it cannot use — no bed count, no coordinates — and a dropped
 *   row takes its listing URL with it. Twenty-two of one probe's
 *   hundred and sixty-four rows went that way. Their addresses were
 *   fine and their pages were real; they were discarded for missing a
 *   number the join does not read.
 *
 * So this skips all of it. No geocoder, no mapper, no skip rules — an
 * address and a URL, which is the whole of what gets joined.
 */
export interface SiteRow {
  address: string;
  sourceUrl?: string;
}

export function siteRowsFrom(raw: readonly Row[]): SiteRow[] {
  const out: SiteRow[] = [];
  for (const row of raw) {
    const line = pickString(row, ADDRESS_KEYS);
    if (!line) continue;
    const sourceUrl = detailUrlOf(row);
    if (!sourceUrl) continue;
    // The street, not "Community Name | Street" — the same reduction the
    // mapper applies, so both sides of the join key the same way.
    out.push({ address: streetPartOf(line), sourceUrl });
  }
  return out;
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

/**
 * Whether a 500 is the scraper failing to FETCH the page, rather than
 * the scraper itself being unwell.
 *
 * Their words, verbatim from a live failure:
 *
 *   "Request failed. You will not be charged for this request. Please
 *    make sure your url is correct and try again. Protected domains
 *    may require adding premium=true OR ultra_premium=true"
 *
 * The giveaway is "you will not be charged" — they bill for their own
 * mistakes and not for ours, so a free failure is one where the page
 * at the other end did not come back. For a city Redfin has no rentals
 * page for, that is exactly what happens, and it arrives as a 500
 * rather than as the 404 the site would show a browser.
 *
 * THE SAME BODY CARRIES "Protected domains may require adding
 * premium=true", and that sentence is boilerplate: the supplier
 * appends it to every failure of this kind, whether the page is
 * genuinely absent or it simply refused to try. So the WORDING cannot
 * separate the two — but the tier we asked on can.
 *
 * On the standard tier that sentence is almost certainly the whole
 * explanation: the supplier will not fetch a protected domain without
 * the flag, so it never looked. On premium or ultra we have already
 * sent what it asked for, and the same body then means the page at the
 * other end really did not come back.
 *
 * Getting this wrong cost the whole feature. Every request was going
 * out on the standard tier, every city came back with this body, every
 * city was read as "no rentals page here", and Boston — three hundred
 * and fifteen rentals listed — told members "the feed carries no
 * furnished units here today". A supplier refusing to try is not an
 * empty market, and must never again be able to read as one.
 */
export function needsPremium(detail: string): boolean {
  return /premium=true|ultra_premium|protected domains?/i.test(detail);
}

export function looksUpstream(detail: string): boolean {
  return /will not be charged|make sure your url is correct/i.test(detail);
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
/**
 * How long one page may take.
 *
 * Under the route's own budget, which is under the platform's function
 * limit, so the chain fails inward: a slow page loses, the route still
 * answers in words, and the browser gets JSON saying why. WITHOUT this
 * the fetch had no deadline at all — a vendor request that hung ran
 * until the platform killed the whole function, and what reached the
 * browser was not our error but a gateway timeout with no body. The
 * screen read "Furnished search unreachable", which was the one thing
 * it was not: we reached them, and waited, and got shot.
 */
const PAGE_TIMEOUT_MS = 45_000;

async function fetchPage(
  pageUrl: string,
  tier: RedfinScrapeTier = redfinScrapeTier()
): Promise<{
  body: unknown;
  rows: Row[];
  parsed: boolean;
  bytes: number;
  credits: number | null;
}> {
  const key = process.env.SCRAPERAPI_KEY;
  if (!key) throw new RedfinError("no-key");

  /**
   * The supplier's own snippet, PLUS the parameter it now asks for by
   * name.
   *
   * This used to be api_key and url alone, with a comment warning that
   * extras which "shouldn't hurt" are how a working request quietly
   * stops working. That was right about speculative extras and wrong
   * about this one, because it is not speculative: every request to
   * redfin.com came back
   *
   *   500 · "Request failed. You will not be charged for this request…
   *          Protected domains may require adding premium=true OR
   *          ultra_premium=true parameter"
   *
   * The supplier has classed the domain as protected and is telling us
   * the flag to send. Premium requests cost several times a standard
   * one, which is the real trade here and why the tier is settable:
   * REDFIN_SCRAPE_TIER=standard turns it off if the domain is ever
   * unprotected again, =ultra buys rendering when premium is refused.
   */
  const params = new URLSearchParams({ api_key: key, url: pageUrl });
  for (const [k, v] of Object.entries(SCRAPE_TIER_PARAMS[tier])) {
    params.set(k, v);
  }

  let res: Response;
  try {
    // Through the shared gate: the vendor meters requests IN FLIGHT,
    // and two paginated passes running their waves side by side is how
    // one of them came back 429 and read as "no houses".
    res = await withScraperSlot(() =>
      fetch(`${REDFIN_SEARCH_ENDPOINT}?${params}`, {
        next: { revalidate: REDFIN_REVALIDATE_SECONDS },
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      })
    );
  } catch (error) {
    // TimeoutError is the deadline above; AbortError is the request
    // being cut off from outside. Both mean "we waited", which is a
    // different fact from "we could not reach them".
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new RedfinError("timeout");
    }
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
    // Asked on the cheap tier and told the domain is protected: the
    // supplier never looked, so this says nothing about the city. On a
    // tier that already sends the flag, the same body falls through to
    // the upstream reading below, where it can still mean a town with
    // no rentals page.
    if (needsPremium(detail) && redfinScrapeTier() === "standard") {
      throw new RedfinError("needs-premium", res.status, detail);
    }
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
 * duplicates is how the biggest market's furnished search outran its whole
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

/** Nothing found, said in the shape a successful walk has. */
function emptyWalk(): SearchWalk {
  return {
    raw: [],
    body: null,
    parsed: true,
    bytes: 0,
    credits: null,
    pages: 1,
    morePages: false,
    failedPages: 0,
  };
}

/**
 * Whether a failure is the kind that can mean "there is nothing here",
 * rather than "the search is broken".
 *
 * 404 and 410 are the site saying a page is not there, which is
 * unambiguous enough to stand on the status alone. A 500 is not: the
 * scraping layer returns it both when it could not fetch the page and
 * when it is having its own trouble, and only the body tells them
 * apart — hence looksUpstream.
 */
function meansNothingHere(error: unknown): boolean {
  if (!(error instanceof RedfinError) || error.reason !== "http") return false;
  if (error.status === 404 || error.status === 410) return true;
  return error.status === 500 && looksUpstream(error.detail ?? "");
}

/**
 * The walk, with one failure reinterpreted: a city the supplier cannot
 * fetch a page for is a city with nothing to show, not an outage.
 *
 * Bailey, Colorado has around seven hundred people and no Redfin
 * rentals page. Asking it for furnished rentals returned
 *
 *   500 · "Request failed. You will not be charged for this request.
 *          Please make sure your url is correct…"
 *
 * and the screen reported that as a failure — for a market whose
 * honest answer is "none". Jacksonville, asked the same way in the
 * same minute, answered fine. So the endpoint works, filter URLs work,
 * and the only thing wrong was a small town having no page.
 *
 * THE DISCRIMINATOR IS THE SAME CITY WITHOUT THE FILTER. Whatever it
 * says, it says about this city rather than about the filter:
 *
 *   fails the same way    the city has no page at all — "none"
 *   no rows, no error     the city has no rentals — "none"
 *   ROWS BACK             the city is FINE, so the filtered URL is what
 *                         is broken — report it, never call it "none"
 *   fails some OTHER way  a real problem; report it unchanged
 *
 * THE THIRD LINE USED TO SAY THE OPPOSITE, and it was wrong in the way
 * that matters most. It read "the city works, so the filter is what is
 * empty", which sounds reasonable and is not: a VALID filter on a
 * working city page answers 200 with an empty result set. It does not
 * answer 404, and it does not answer the supplier's upstream 500. An
 * error on the filtered URL while the bare URL serves rows says the
 * URL is wrong, not that the inventory is empty.
 *
 * What that cost: Boston, with hundreds of furnished rentals listed,
 * read "No furnished rentals listed in Boston — the feed carries no
 * furnished units here today". A confident, specific, wrong answer, in
 * the one place a member decides whether a market is worth working.
 * The gap the old comment admitted it could not see — "if the site
 * began refusing us everywhere, every market would read no furnished
 * rentals" — was not hypothetical; it was live, and it presented as
 * fact rather than as a failure.
 *
 * Bailey, Colorado — the case this whole function exists for — is
 * untouched: it has no rentals page at all, so the bare probe fails
 * the same way and the honest "none" still stands.
 *
 * Costs one extra request, only on a path that otherwise returns
 * nothing usable, and only after the opening page has had its retry.
 */
async function walkOrEmpty(
  market: Market,
  searchUrl: string,
  opts: { furnished?: boolean; propertyType?: string; pages?: number }
): Promise<SearchWalk> {
  const filtered = Boolean(opts.furnished || opts.propertyType);
  try {
    return await fetchRedfinSearchRows(searchUrl, maxPages(opts.pages));
  } catch (error) {
    if (!filtered || !meansNothingHere(error)) throw error;

    const bare = await redfinRentalsUrl(market, {});
    if (!bare || bare === searchUrl) throw error;

    // The verdict is reached AFTER the probe's own try/catch, never
    // inside it: a `throw error` in the try lands in the catch below,
    // where the original error passes the meansNothingHere check and
    // is swallowed — so the rethrow silently does nothing and every
    // path still returns "none". It did exactly that on the first
    // attempt at this fix, and the suite went green over a change that
    // had no effect.
    let plain: SearchWalk;
    try {
      plain = await fetchRedfinSearchRows(bare, 1);
    } catch (probeError) {
      // The city has no page either — which answers the question that
      // was asked. Anything else is a problem worth reporting.
      if (!meansNothingHere(probeError)) throw error;
      return emptyWalk();
    }
    // The city serves rentals. A filter that merely matched nothing
    // would have answered 200 and empty, so this failure is about the
    // URL rather than the inventory — and calling it "none" is how a
    // whole metro reads as having no furnished units.
    if (plain.raw.length > 0) throw error;
    // The city has a page and no rentals on it at all, so it has no
    // furnished ones either.
    return emptyWalk();
  }
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
  const walk = await walkOrEmpty(market, searchUrl, opts);
  const furnished = Boolean(opts.furnished);
  const mapped =
    opts.map === false
      ? { listings: [], skipped: {}, geocodedBy: {} }
      : await mapRedfinRows(walk.raw, market, { furnished });
  return { ...mapped, ...walk, searchUrl };
}

/** Every page of one search, exactly as the vendor returns them. */
export interface SearchWalk {
  raw: Row[];
  body: unknown;
  parsed: boolean;
  bytes: number;
  credits: number | null;
  pages: number;
  morePages: boolean;
  failedPages: number;
}

/**
 * Every page of one search URL, up to `limit` — a city's rentals for
 * the Furnished filter and the market join, a ZIP's for the page
 * lookup — following the site's own next-page links.
 */
export async function fetchRedfinSearchRows(
  searchUrl: string,
  limit: number,
  /** Diagnostics only: ask on a tier other than the configured one,
   *  so a probe can measure whether a dearer one gets through without
   *  an operator having to redeploy to find out. */
  tier: RedfinScrapeTier = redfinScrapeTier()
): Promise<SearchWalk> {
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
  let retriedOpening = false;

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
      const why = (settled[0] as PromiseRejectedResult).reason;
      // A throttle on the opening page is the vendor counting requests
      // in flight across the whole fleet — lookups still retrying on
      // another instance, say — not a verdict on this search. One
      // patient retry, as the later pages already get.
      //
      // A 5xx earns the same patience for a different reason: the
      // scraping layer answers 500 when its own fetch of the page went
      // wrong, which is as often a blip on their side as a fact about
      // the page. Retrying once separates the two — and matters most
      // here, because the alternative is telling a member their search
      // failed on the strength of a single bad round trip.
      const transient =
        why instanceof RedfinError &&
        (why.reason === "quota" ||
          (why.reason === "http" && (why.status ?? 0) >= 500));
      if (transient && !retriedOpening) {
        retriedOpening = true;
        await new Promise((r) => setTimeout(r, 2_500));
        queue = [...wave, ...queue];
        continue;
      }
      throw why;
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
  return { raw, body, parsed, bytes, credits, pages, morePages, failedPages };
}
