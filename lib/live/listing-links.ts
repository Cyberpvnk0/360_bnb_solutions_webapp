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
 *   2. Realtor, searched by address, for a property Redfin does not
 *      carry. A search rather than a guessed property URL: Realtor keys
 *      a property by an internal id, a guessed id 404s, and a dead
 *      button is worse than no button.
 *
 * NO ZILLOW. It used to hold slot two, on the reasoning that it was the
 * only portal addressable by address alone. That was true and beside
 * the point: their address search resolves to the property often enough
 * to look like it works and misses often enough to be untrustworthy,
 * and a link that is usually right is worse than one that is either
 * right or absent, because nobody learns to check it.
 */

export interface Addressed {
  address: string;
  city: string;
  stateCode: string;
  /** The listing's own page at its source, when the source told us. */
  sourceUrl?: string;
}

/**
 * Their alphabet: letters, digits, spaces and the punctuation their
 * slugs actually carry. Everything else is dropped rather than escaped.
 *
 * A unit marker in particular — "#4B" — is legal in a path but starts a
 * fragment in a browser, which silently truncates the address to
 * everything before the unit and searches the wrong place.
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
 */
function usableSource(url: string | undefined): string | null {
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
 * the lister's details are certain to be. The address search that
 * stands in otherwise lands near the property, not on it, so copy
 * that promises the lister must check this first.
 */
export function hasOwnListingPage(place: Addressed): boolean {
  return usableSource(place.sourceUrl) !== null;
}

/**
 * Where to see this property's photos, or null when we have too little
 * of an address to send anyone anywhere.
 *
 * Null is a real answer and callers must render nothing for it: a
 * search for half an address lands on a city page full of other
 * people's houses, which looks like a bug and wastes a click.
 */
export function photosHref(place: Addressed): string | null {
  const own = usableSource(place.sourceUrl);
  if (own) return own;

  const p = parts(place);
  if (!p) return null;

  // Their search path takes the same address slug their detail URLs
  // are built from, minus the internal property id we cannot know:
  // "1234-Palm-Ave_Tampa_FL". Underscores between the parts, hyphens
  // inside them.
  const slug = [p.street, p.city, p.state]
    .filter(Boolean)
    .map((part) => part.replace(/\s+/g, "-"))
    .join("_");

  return `https://www.realtor.com/realestateandhomes-search/${encodeURI(slug)}`;
}
