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

/** The shape of a property page's path on the portal. */
const PROPERTY_PATH = /^\/[A-Z]{2}\/[^?#\s]+\/home\/\d+/;
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
  if (
    typeof row.url === "string" &&
    PROPERTY_PATH.test(row.url) &&
    typeof row.name === "string" &&
    row.name.trim()
  ) {
    out.push({ name: row.name.trim(), url: row.url });
  }
  for (const v of Object.values(row)) extractAddressRows(v, depth + 1, out);
  return out;
}

/**
 * The page for exactly this address, or null. The street and unit must
 * key the same way on both sides — "St" against "Street" is fine, unit
 * 4 against unit 5 is not — and the row's line must name the town and
 * the state, as its own token.
 */
export function pickAddressRow(
  rows: readonly AddressRow[],
  place: { address: string; city: string; stateCode: string }
): string | null {
  const want = addressKey(place.address);
  if (!want) return null;
  const wantCity = normalizeCity(place.city);
  const state = new RegExp(`\\b${place.stateCode.trim().toLowerCase()}\\b`);
  for (const row of rows) {
    if (addressKey(row.name) !== want) continue;
    const tail = row.name.split(",").slice(1).join(" ");
    if (wantCity && !normalizeCity(tail).includes(wantCity)) continue;
    if (!state.test(tail.toLowerCase())) continue;
    return `${PORTAL}${row.url.split(/[?#]/)[0]}`;
  }
  return null;
}

function storeKey(place: { address: string; stateCode: string }): string | null {
  const key = addressKey(place.address);
  return key ? `page:${place.stateCode.trim().toLowerCase()}:${key}` : null;
}

/**
 * The listing page for a row that arrived without one, or null when
 * the portal does not know the address. Never throws.
 */
export async function resolveListingPage(place: {
  address: string;
  city: string;
  stateCode: string;
}): Promise<string | null> {
  const key = storeKey(place);
  if (!key) return null;

  const stored = await readKeyedBlob(key).catch(() => null);
  if (stored) {
    const url = (stored.value as { url?: unknown }).url;
    if (typeof url === "string" && isFresh(stored.at, HIT_TTL_MS)) return url;
    if (url === null && isFresh(stored.at, MISS_TTL_MS)) return null;
  }

  const apiKey = process.env.SCRAPERAPI_KEY;
  if (!apiKey) return null;
  try {
    const { body } = await fetchAutocomplete(
      autocompleteUrlFor(`${place.address}, ${place.city}, ${place.stateCode}`),
      apiKey
    );
    const url = pickAddressRow(extractAddressRows(body), place);
    // A miss is remembered too, so a listing the portal does not carry
    // is not looked up on every open.
    void writeKeyed(key, { url }).catch(() => undefined);
    return url;
  } catch {
    return null;
  }
}
