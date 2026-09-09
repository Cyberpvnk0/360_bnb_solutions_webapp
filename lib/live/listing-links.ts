/**
 * A link out to where the photos are.
 *
 * Listing photos are copyrighted separately from the listing itself —
 * the photographer's, then the brokerage's, governed by display rules
 * we hold no licence under. This product hosts none, welds none onto
 * rows, and fetches none. Every card draws a Street View or an aerial
 * of the kerb; anyone who wants the interiors goes to a site that is
 * licensed to show them.
 *
 * A link is not a copy. It is what a search engine does, it never goes
 * stale, and it puts the traffic back where the photos came from.
 *
 * TWO DESTINATIONS, IN ORDER:
 *
 *   1. The listing's OWN page on Redfin. That is the exact property, on
 *      the site that published it, one click away. Nothing beats it,
 *      and lib/live/listing-join exists to make this the case for as
 *      many rows as possible rather than only the ones that arrived
 *      with a URL attached.
 *
 *   2. A web search for the address, scoped to those two sites.
 *
 * And a way from two to one: on a surface that shows a single property
 * (the analyzer, the detail panel), a row without a page asks the
 * portal for it by address — lib/live/redfin-page, through
 * app/api/listing-page — and the link becomes the listing when the
 * answer lands. See components/deals/photos-link.
 *
 * WHY SLOT TWO IS A SEARCH ENGINE AND NOT A PORTAL URL.
 *
 * Both portals key a property by an internal id — Redfin by a city id
 * and a home id, Realtor by an `M…` property id — and neither exposes a
 * URL that takes a street address and resolves it. A guessed one does
 * not 404, which would at least be honest; it silently degrades into
 * that market's for-rent page. Twenty properties clicked in Jacksonville
 * landed on the same Jacksonville page, which is the exact failure this
 * module's header has warned about since the Zillow removal: a link that
 * goes somewhere plausible and is not this property.
 *
 * A quoted-address, site-scoped search is correct by construction rather
 * than by guess. The engine holds the address-to-URL index the portals
 * decline to expose, the query is built from facts we hold, and there is
 * no id to be wrong about. It costs one extra click, and it shows the
 * reader the address in the result titles so they can see whether it
 * found the right place — which is the property a guessed URL lacks.
 * Redfin is named first in the query and Realtor is the fallback within
 * it, so the ranking follows the same order this module already states.
 *
 * NO ZILLOW. It used to hold slot two, on the reasoning that it was the
 * only portal addressable by address alone. That was true and beside the
 * point: their address search resolves to the property often enough to
 * look like it works and misses often enough to be untrustworthy, and a
 * link that is usually right is worse than one that is either right or
 * absent, because nobody learns to check it.
 */

export interface Addressed {
  address: string;
  city: string;
  stateCode: string;
  /** The listing's own page at its source, when the source told us. */
  sourceUrl?: string;
}

/**
 * Their alphabet: letters, digits, spaces and the punctuation an address
 * actually carries. Everything else is dropped rather than escaped.
 *
 * A unit marker in particular — "#4B" — starts a fragment in a browser,
 * which silently truncates whatever follows it.
 */
function clean(part: string | undefined): string {
  return (part ?? "")
    .replace(/[^\p{L}\p{N}\s,.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The three parts, cleaned, or null when too little is left to search. */
function parts(
  place: Addressed
): { street: string; city: string; state: string } | null {
  // Cleaned BEFORE the length check, not after. An address of "///" is
  // three characters and no address at all, and checking the raw string
  // let it through to build a link to the city — a link that works,
  // goes somewhere plausible, and is not this property.
  const street = clean(place.address);
  const city = clean(place.city);
  const state = clean(place.stateCode);

  // A street line alone is ambiguous across fifty states, and a city
  // alone is not this property. Both, or nothing.
  if (street.length < 3 || city.length < 2) return null;
  return { street, city, state };
}

/**
 * A source URL we will actually send somebody to.
 *
 * Only ever https, and only ever to the listing site itself: this
 * string was read off a vendor payload, and a payload is not a place to
 * take a navigation target from on trust. Anything else falls through
 * to the address search.
 *
 * Exported for the two places a listing's page crosses a trust
 * boundary on its way to the analyzer: going INTO the analyze link, and
 * coming back OUT of the query string, where anyone can have typed
 * anything. Both apply exactly this rule, so the result page links
 * where the card would have.
 */
export function usableListingPage(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    if (!/(^|\.)redfin\.com$/i.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Whether the row carries its own page at the source — the one place
 * the lister's details are certain to be. The search that stands in
 * otherwise finds the property rather than opening it, so copy that
 * promises the lister must check this first.
 */
export function hasOwnListingPage(place: Addressed): boolean {
  return usableListingPage(place.sourceUrl) !== null;
}

/**
 * The sites a fallback search is allowed to find, in preference order.
 * Redfin is the product's source of record; Realtor covers what Redfin
 * does not carry. Nothing else — a general web search for an address
 * returns lead-generation pages that exist to harvest a phone number.
 */
const SEARCH_SITES = ["redfin.com", "realtor.com"] as const;

/**
 * The words of a street line that have more than one spelling, and so
 * must never be quoted: a directional is "E" on the portal and "East"
 * from the geocoder, and a suffix is "St" on one and "Street" on the
 * other. Long and short forms both, lower-cased.
 */
const DIRECTIONALS = new Set([
  "n", "s", "e", "w", "ne", "nw", "se", "sw",
  "north", "south", "east", "west",
  "northeast", "northwest", "southeast", "southwest",
]);
const SUFFIXES = new Set([
  "st", "street", "ave", "avenue", "rd", "road", "dr", "drive", "ln", "lane",
  "ct", "court", "blvd", "boulevard", "ter", "terrace", "pl", "place",
  "cir", "circle", "pkwy", "parkway", "hwy", "highway", "trl", "trail",
  "expy", "expressway", "sq", "square", "xing", "crossing", "pt", "point",
  "way", "loop", "run", "path", "walk", "row", "aly", "alley", "cv", "cove",
  "hts", "heights", "pass", "plz", "plaza", "trce", "trace", "bnd", "bend",
]);
const UNIT_WORDS = new Set(["apt", "apartment", "unit", "ste", "suite", "rm", "room"]);

/**
 * The two words of a street line that identify the property and have
 * only one way of being written: the house number and the street's
 * own name. "1804 East Sitka Street" and "1804 E Sitka St" share
 * exactly "1804" and "Sitka", and nothing else.
 */
export function searchTerms(street: string): { number: string | null; name: string | null } {
  // The street line proper: a unit after a comma is not part of it.
  const line = street.split(",")[0].trim();
  const words = line.split(" ").filter(Boolean);
  const number = /^\d+[a-z]?$/i.test(words[0] ?? "") ? words[0] : null;
  let name: string | null = null;
  for (const word of number ? words.slice(1) : words) {
    const bare = word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
    if (bare === "") continue;
    // A unit marker ends the street's name; whatever follows is the
    // flat, which the portal writes its own way.
    if (UNIT_WORDS.has(bare) || /^#/.test(word)) break;
    if (DIRECTIONALS.has(bare) || SUFFIXES.has(bare)) continue;
    name = word.replace(/[.,]+$/g, "");
    break;
  }
  return { number, name };
}

/**
 * A search that finds this exact property on one of those two sites.
 *
 * QUOTE THE TWO WORDS THAT HAVE ONE SPELLING, AND NOTHING ELSE. An
 * earlier cut quoted the whole street line, and the line it was handed
 * came from a geocoder that writes "1804 East Sitka Street" while the
 * portal's page says "1804 E Sitka St": an exact-phrase search for the
 * one cannot match the other, and the engine answered that no page on
 * either site matched — for a listing that was there. The house number
 * and the street's own name are written the same way everywhere, so
 * they go in quoted and pin the result to this property; the rest of
 * the line (the directional, the suffix, the unit) is what has two
 * spellings, so it stays out. The site filter keeps the results to
 * pages that actually hold the listing and its photos.
 *
 * A line with no number — a named building — is quoted whole, since
 * there is nothing else to hold it to.
 */
export function listingSearchHref(place: Addressed): string | null {
  const p = parts(place);
  if (!p) return null;

  const { number, name } = searchTerms(p.street);
  const pin =
    number && name
      ? `"${number}" "${name}"`
      : `"${p.street}"`;
  const sites = SEARCH_SITES.map((s) => `site:${s}`).join(" OR ");
  const query = `${pin} ${p.city} ${p.state} (${sites})`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/**
 * The finder page for an address whose listing page is still being
 * looked up: /go/listing opens at once, asks the listing site, and
 * lands on the listing when the answer comes — or on the search when
 * there is no page. A click during the lookup lands where the link
 * would have, rather than on a search because it came early.
 */
export function findingHref(place: Addressed): string | null {
  const p = parts(place);
  if (!p) return null;
  const query = new URLSearchParams({
    address: p.street,
    city: p.city,
    state: p.state,
  });
  return `/go/listing?${query}`;
}

/** Which destination a link goes to, so the label can say so. A
 *  search finds the listing; it does not open it, and copy that
 *  claims otherwise spends the reader's click on a surprise. "finding"
 *  is the listing, by way of the finder page. */
export type PhotosLinkKind = "listing" | "search" | "finding";

export interface PhotosDestination {
  href: string;
  kind: PhotosLinkKind;
}

/**
 * Where to see this property's photos, and whether that is the listing
 * itself or a search for it. Null when we have too little of an address
 * to send anyone anywhere.
 *
 * Null is a real answer and callers must render nothing for it: a
 * search for half an address returns other people's houses, which looks
 * like a bug and wastes a click.
 */
export function photosLink(place: Addressed): PhotosDestination | null {
  const own = usableListingPage(place.sourceUrl);
  if (own) return { href: own, kind: "listing" };

  const search = listingSearchHref(place);
  return search ? { href: search, kind: "search" } : null;
}

/** The href alone, for callers that don't render a label. */
export function photosHref(place: Addressed): string | null {
  return photosLink(place)?.href ?? null;
}
