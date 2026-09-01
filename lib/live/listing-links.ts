/**
 * Links out to where the photos are.
 *
 * Listing photos are copyrighted separately from the listing itself —
 * the photographer's, then the brokerage's, governed by display rules
 * we hold no licence under. That is why no data vendor at any sane
 * price ships them, and why this product hosts none at all. Every card
 * draws a Street View of the kerb; anyone who wants the interiors goes
 * to a site that is licensed to show them.
 *
 * A link is not a copy. It is what a search engine does, it never goes
 * stale, and it puts the traffic back where the photos came from.
 *
 * ONE DESTINATION, ON PURPOSE. Zillow carries the most rental
 * inventory of the major portals and is strongest on the single-family
 * and condo stock an arbitrage operator actually leases — and it is the
 * only one of the three that can be addressed BY ADDRESS. Redfin keys a
 * city by an opaque internal id and Realtor keys a property by an
 * internal property id; we hold neither, so a link to either would
 * either 404 on a guessed URL or land on a city page, which is "view
 * this city" wearing the label somebody asked for.
 *
 * A menu of one good link and two bad ones is worse than the one link.
 */

export interface Addressed {
  address: string;
  city: string;
  stateCode: string;
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
 * Where to see this property's photos, or null when we have too little
 * of an address to send anyone anywhere.
 *
 * Null is a real answer and callers must render nothing for it: a
 * search for half an address lands on a city page full of other
 * people's houses, which looks like a bug and wastes a click.
 */
export function photosHref(place: Addressed): string | null {
  const p = parts(place);
  if (!p) return null;

  // "1234 Palm Ave, Tampa, FL" → "1234-Palm-Ave,-Tampa,-FL"
  const slug = [p.street, p.city, p.state]
    .filter(Boolean)
    .join(", ")
    .replace(/\s/g, "-");

  // for_rent, because these are rentals and their default search is for
  // sale — landing on a buy page for a lease is a wrong answer that
  // looks like a right one.
  return `https://www.zillow.com/homes/for_rent/${encodeURI(slug)}_rb/`;
}
