/**
 * A listing's page on the portal, found from its address.
 *
 * Most rows get their page from the market join (lib/live/listing-join),
 * which matches the rentals feed against the portal's search for the
 * whole market. Some never do: a listing that appeared after the last
 * join, a unit the two sides write differently, a page deeper than the
 * join reads. Such a row had no page on file, so its contact was never
 * looked up — and the panel said the listing published none, which was
 * not true and cost somebody a phone call.
 *
 * So, on open, a row without a page asks the portal's own address
 * lookup — the same endpoint that resolves a city to its id, fed a
 * street line instead — and takes the page it names. STRICTLY: the
 * answer's street and unit must key identically to the row's, and its
 * town and state must match, or there is no page. A wrong page here is
 * a stranger's phone number under somebody's address.
 *
 * One request through the scraping vendor per address, ever: hits are
 * kept a month and misses a week in the shared store.
 */

import { addressKey } from "./address";
import { autocompleteUrlFor, fetchAutocomplete, normalizeCity } from "./redfin-city";
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
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  /** Why there is no page, for the person reading the route's answer:
   *  what the lookup returned and what was rejected. Never a value off
   *  a listing. */
  detail: string | null;
}

export async function resolveListingPage(place: {
  address: string;
  city: string;
  stateCode: string;
  zip?: string;
}): Promise<PageLookup> {
  const key = storeKey(place);
  if (!key) return { url: null, detail: "address could not be keyed" };

  const stored = await readKeyedBlob(key).catch(() => null);
  if (stored) {
    const url = (stored.value as { url?: unknown }).url;
    if (typeof url === "string" && isFresh(stored.at, HIT_TTL_MS)) {
      return { url, detail: null };
    }
    if (url === null && isFresh(stored.at, MISS_TTL_MS)) {
      return { url: null, detail: "no page, remembered from an earlier lookup" };
    }
  }

  const apiKey = process.env.SCRAPERAPI_KEY;
  if (!apiKey) return { url: null, detail: "no scraping key configured" };
  try {
    const { attempt, body, tried } = await fetchAutocomplete(
      autocompleteUrlFor(`${place.address}, ${place.city}, ${place.stateCode}`),
      apiKey
    );
    if (body === null) {
      return {
        url: null,
        detail: `lookup did not answer (HTTP ${attempt.status} on ${tried.join(", ")})`,
      };
    }
    const rows = extractAddressRows(body);
    const url = pickAddressRow(rows, place);
    // A miss is remembered too, so a listing the portal does not carry
    // is not looked up on every open.
    void writeKeyed(key, { url }).catch(() => undefined);
    return {
      url,
      detail: url
        ? null
        : `lookup answered with ${rows.length} property page${rows.length === 1 ? "" : "s"}, none for this address`,
    };
  } catch (e) {
    return { url: null, detail: e instanceof Error ? e.message : "lookup failed" };
  }
}
