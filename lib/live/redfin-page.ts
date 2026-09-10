/**
 * A listing's page on the portal, found from its address.
 *
 * Most rows get their page from the market join (lib/live/listing-join),
 * which matches the rentals feed against the portal's search for the
 * whole market. Some never do: a listing that appeared after the last
 * join, a unit the two sides write differently, a page deeper than the
 * join reads. Such a row had no page on file, so its contact was never
 * looked up — and the panel said the listing published none, which was
 * not true and cost somebody a phone call. A typed address never had a
 * page at all.
 *
 * TWO WAYS TO THE PAGE, IN ORDER:
 *
 *   1. The portal's own rentals search for the address's ZIP, keyed by
 *      address (lib/live/zip-pages). The structured endpoint behind it
 *      has been dependable — it is what the Furnished filter rides —
 *      and a ZIP is a few pages, read once a day for everyone. An
 *      address absent from a ZIP whose every page was read is not among
 *      the site's rentals, and that is an answer.
 *
 *   2. The portal's address lookup — the endpoint that resolves a city
 *      to its id, fed a street line — for an address with no ZIP to
 *      search, or a ZIP with more pages than were read. It goes through
 *      the plain proxy, which on this domain is slow and sometimes never
 *      answers: the last resort, not the first.
 *
 * STRICTLY, both ways: the answer's street and unit must key identically
 * to the row's, and the ZIP (or the state and town) must match, or
 * there is no page. A wrong page here is a stranger's phone number
 * under somebody's address.
 *
 * Hits are kept a month in the shared store; a miss a day, since the
 * ZIP's search is read again daily and a listing may be on it tomorrow.
 */

import { addressKey } from "./address";
import { autocompleteUrlFor, fetchAutocomplete, normalizeCity } from "./redfin-city";
import { zipFromAddress } from "./zip";
import { pageInZip, readZipPages } from "./zip-pages";
import { lookupZipAt } from "@/lib/map/zip-boundary";
import { isFresh, readKeyedBlob, writeKeyed } from "@/lib/db/market-store";

export interface AddressRow {
  /** "1804 E Sitka St, Tampa, FL 33604" */
  name: string;
  /** "/FL/Tampa/1804-E-Sitka-St-33604/home/47311661" */
  url: string;
}

/** The shape of a property page's path on the portal:
 *  /FL/Tampa/1804-E-Sitka-St-33604/home/47311661, with an optional
 *  /unit-2/ before "home". The path names the state, the town, the
 *  street (ZIP last) and the unit — everything a match needs, whether
 *  or not the row's own fields say them. */
const PROPERTY_PATH =
  /^\/([A-Z]{2})\/([^/?#\s]+)\/([^/?#\s]+)(?:\/unit-([^/?#\s]+))?\/home\/\d+/;
const PORTAL = "https://www.redfin.com";

const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A day, not a week: the ZIP's search is read again daily, and the
 *  listing may be on it tomorrow. */
const MISS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Time for the whole resolution, and for the address lookup inside it.
 * A bypass request on the portal takes twenty seconds on a good day
 * and the vendor retries for about seventy; the routes that call this
 * budget for this AND, for the contact, the page read that follows.
 */
const TOTAL_BUDGET_MS = 80_000;
const LOOKUP_BUDGET_MS = 50_000;
/** The address lookup is not started with less than this. */
const MIN_LOOKUP_MS = 15_000;
/**
 * The fast resolution — a "View photos" click — reads the store and
 * the ZIP's rentals and nothing slower: no address lookup, and the ZIP
 * read itself is given this long before the click moves on to the
 * next site. The read carries on behind the answer and is stored, so
 * the next click on the ZIP is instant.
 */
export const FAST_ZIP_BUDGET_MS = 8_000;

/** Every property row in a lookup payload, wherever it nests. */
export function extractAddressRows(
  value: unknown,
  depth = 0,
  out: AddressRow[] = []
): AddressRow[] {
  if (depth > 8 || out.length > 60) return out;
  if (Array.isArray(value)) {
    for (const v of value) extractAddressRows(v, depth + 1, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const row = value as Record<string, unknown>;
  if (typeof row.url === "string" && PROPERTY_PATH.test(row.url)) {
    // The line the row prints, from whichever fields carry it: the
    // lookup writes the street in `name` and the town in `subName` (or
    // `market`), and an older shape wrote the whole line in `name`.
    const line = [row.name, row.subName, row.market]
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .join(", ");
    out.push({ name: line, url: row.url });
  }
  for (const v of Object.values(row)) extractAddressRows(v, depth + 1, out);
  return out;
}

/** What the page's path says about the property. */
export function parsePropertyPath(url: string): {
  state: string;
  city: string;
  street: string;
  zip: string | null;
  unit: string | null;
} | null {
  const m = PROPERTY_PATH.exec(url);
  if (!m) return null;
  const words = m[3].split("-");
  const zip = /^\d{5}$/.test(words[words.length - 1]) ? words.pop()! : null;
  return {
    state: m[1].toUpperCase(),
    city: m[2].replace(/-/g, " "),
    street: words.join(" "),
    zip,
    unit: m[4] ? m[4].replace(/-/g, " ") : null,
  };
}

/**
 * The page for exactly this address, or null.
 *
 * The match is made on the page's own path rather than on the row's
 * printed line, because the path always carries the state, the town,
 * the street and the unit, and the printed line carries whatever the
 * lookup felt like printing. The street and unit must key the same way
 * on both sides — "St" against "Street" is fine, unit 4 against unit 5
 * is not — the state must be the one asked for, and the town must
 * match or, failing that, the ZIP must. A near miss is no page: a
 * wrong page is a stranger's number under somebody's address.
 */
export function pickAddressRow(
  rows: readonly AddressRow[],
  place: { address: string; city: string; stateCode: string; zip?: string }
): string | null {
  const want = addressKey(place.address);
  if (!want) return null;
  const wantCity = normalizeCity(place.city);
  const wantState = place.stateCode.trim().toUpperCase();
  for (const row of rows) {
    const path = parsePropertyPath(row.url);
    if (!path || path.state !== wantState) continue;
    const townMatches = wantCity !== "" && normalizeCity(path.city) === wantCity;
    const zipMatches = !!place.zip && path.zip === place.zip;
    if (!townMatches && !zipMatches) continue;
    const theirs = addressKey(
      path.unit ? `${path.street} Unit ${path.unit}` : path.street
    );
    if (theirs !== want) continue;
    return `${PORTAL}${row.url.split(/[?#]/)[0]}`;
  }
  return null;
}

/** A place to find the page for: the address it must match, and the
 *  ZIP and point that say where to look. */
export interface Place {
  address: string;
  city: string;
  stateCode: string;
  zip?: string;
  point?: { lat: number; lon: number };
}

function storeKey(place: { address: string; stateCode: string }): string | null {
  const key = addressKey(place.address);
  return key ? `page:v2:${place.stateCode.trim().toLowerCase()}:${key}` : null;
}

/**
 * The listing page for a row that arrived without one, or null when
 * the portal does not know the address. Never throws.
 */
export interface PageLookup {
  url: string | null;
  /** False when the portal never answered — the clock ran out, every
   *  tier was refused, no key — as opposed to answering that it has no
   *  such page. The two must not read the same: one is "try again",
   *  the other is "not here". */
  answered: boolean;
  /** Why there is no page, for the person reading the route's answer:
   *  what each step returned and what was rejected. Never a value off
   *  a listing. */
  detail: string | null;
}

/** Lookups under way in this process, by store key: the analyzer's
 *  link, its finder page and the contact panel can all ask about one
 *  address inside the same half-minute, and each is a billed request
 *  if it goes out on its own. */
const inFlight = new Map<string, Promise<PageLookup>>();

export interface ResolveOptions {
  /**
   * True for a click that must move on: the store and the ZIP's
   * rentals are read, within FAST_ZIP_BUDGET_MS, and the slow address
   * lookup is never started. A "no" from this path says only that the
   * fast places had no page.
   */
  fast?: boolean;
  /** Tests only: the fast path's budget for the ZIP read. */
  fastBudgetMs?: number;
}

export async function resolveListingPage(
  place: Place,
  opts: ResolveOptions = {}
): Promise<PageLookup> {
  const key = storeKey(place);
  if (!key) return { url: null, answered: true, detail: "address could not be keyed" };

  // A fast caller never joins a slow lookup already under way: it
  // would wait for the very thing it exists to skip.
  const slot = opts.fast ? `fast:${key}` : key;
  const running = inFlight.get(slot);
  if (running) return running;
  const lookup = lookupOnce(place, key, opts).finally(() => inFlight.delete(slot));
  inFlight.set(slot, lookup);
  return lookup;
}

/** The read, or nothing when it has not answered in time. */
function within<T>(ms: number, work: Promise<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

/** The ZIP to search: the row's own, the address line's, or the one
 *  under the point. */
async function zipFor(place: Place): Promise<string | null> {
  const own = place.zip?.trim();
  if (own && /^\d{5}$/.test(own)) return own;
  const inLine = zipFromAddress(place.address);
  if (inLine) return inLine;
  return place.point ? lookupZipAt(place.point) : null;
}

async function lookupOnce(place: Place, key: string, opts: ResolveOptions): Promise<PageLookup> {
  const stored = await readKeyedBlob(key).catch(() => null);
  if (stored) {
    const url = (stored.value as { url?: unknown }).url;
    if (typeof url === "string" && isFresh(stored.at, HIT_TTL_MS)) {
      return { url, answered: true, detail: null };
    }
    if (url === null && isFresh(stored.at, MISS_TTL_MS)) {
      return {
        url: null,
        answered: true,
        detail: "no page, remembered from an earlier lookup",
      };
    }
  }

  const started = Date.now();
  const notes: string[] = [];
  const remember = (url: string | null) =>
    void writeKeyed(key, { url }).catch(() => undefined);

  // 1. The ZIP's rentals, keyed by address.
  const zip = await zipFor(place);
  if (!zip) {
    notes.push("no ZIP to search");
  } else {
    const read = opts.fast
      ? await within(opts.fastBudgetMs ?? FAST_ZIP_BUDGET_MS, readZipPages(zip))
      : await readZipPages(zip);
    if (read === null) {
      notes.push(`${zip}: the rentals were still being read when the click moved on`);
    } else if (!read.ok) {
      notes.push(`${zip}: ${read.detail}`);
    } else {
      const { pages } = read;
      const url = pageInZip(pages, place.address);
      if (url) {
        remember(url);
        return { url, answered: true, detail: null };
      }
      notes.push(
        `${pages.rows} rental${pages.rows === 1 ? "" : "s"} in ${zip}` +
          `${pages.complete ? "" : ` (first ${pages.pages} pages)`}, none at this address`
      );
      if (pages.complete) {
        // Read whole and not there: not among the site's rentals today.
        remember(null);
        return { url: null, answered: true, detail: notes.join("; ") };
      }
    }
  }

  // A click does not wait for the slow lookup: the fast places had no
  // page, and the click moves on to the next site.
  if (opts.fast) {
    return { url: null, answered: false, detail: notes.join("; ") || "nothing fast to read" };
  }

  // 2. The portal's address lookup, with what time is left.
  const apiKey = process.env.SCRAPERAPI_KEY;
  if (!apiKey) {
    return {
      url: null,
      answered: false,
      detail: [...notes, "no scraping key configured"].join("; "),
    };
  }
  const left = TOTAL_BUDGET_MS - (Date.now() - started);
  if (left < MIN_LOOKUP_MS) {
    return {
      url: null,
      answered: false,
      detail: [...notes, "no time left for the address lookup"].join("; "),
    };
  }
  try {
    const { attempt, body, tried } = await fetchAutocomplete(
      autocompleteUrlFor(`${place.address}, ${place.city}, ${place.stateCode}`),
      apiKey,
      { budgetMs: Math.min(LOOKUP_BUDGET_MS, left) }
    );
    if (body === null) {
      // Not remembered: time running out says nothing about the address.
      const why = attempt.status === 408 ? attempt.text : `HTTP ${attempt.status}`;
      return {
        url: null,
        answered: false,
        detail: [...notes, `lookup did not answer (${why} on ${tried.join(", ")})`].join("; "),
      };
    }
    const rows = extractAddressRows(body);
    const url = pickAddressRow(rows, place);
    remember(url);
    return {
      url,
      answered: true,
      detail: url
        ? null
        : [
            ...notes,
            `lookup answered with ${rows.length} property page${rows.length === 1 ? "" : "s"}, none for this address`,
          ].join("; "),
    };
  } catch (e) {
    return {
      url: null,
      answered: false,
      detail: [...notes, e instanceof Error ? e.message : "lookup failed"].join("; "),
    };
  }
}
