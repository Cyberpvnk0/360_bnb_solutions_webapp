/**
 * A link out to where the photos are.
 *
 * Listing photos are copyrighted separately from the listing itself —
 * the photographer's, then the brokerage's, governed by display rules
 * we hold no licence under. That is why no data vendor at any sane
 * price ships them, and why borrowing them was always the shakiest
 * thing this product did.
 *
 * A link is not a copy. Sending somebody to the page where the pictures
 * already live is what every search engine does, costs nothing, never
 * goes stale, and puts the traffic back where the photos came from.
 *
 * WHY A SEARCH AND NOT A PROPERTY PAGE. We do not know the destination
 * site's id for a property, and guessing a canonical URL means a 404
 * whenever the guess is wrong — a dead button is worse than no button.
 * An address search always lands somewhere useful: on the listing when
 * it exists, on the surrounding results when it doesn't.
 *
 * WHY THIS DESTINATION. It carries the most rental inventory of the
 * major portals and is strongest on single-family and condo rentals,
 * which is exactly the stock an arbitrage operator leases. Adding
 * another is one entry below; there is one because one is the answer.
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

/**
 * Where to see this property's photos, or null when we have too little
 * of an address to send anyone anywhere.
 *
 * Null is a real answer and callers must render nothing for it: a
 * search for half an address lands on a city page full of other
 * people's houses, which looks like a bug and wastes a click.
 */
export function photosHref(place: Addressed): string | null {
  // Cleaned BEFORE the length check, not after. An address of "///" is
  // three characters and no address at all, and checking the raw string
  // let it through to build a link to the city — a link that works,
  // goes somewhere plausible, and is not this property. That is the
  // worst failure this function has, so it is the one under test.
  const street = clean(place.address);
  const city = clean(place.city);
  const state = clean(place.stateCode);

  // A street line alone is ambiguous across fifty states, and a city
  // alone is not this property. Both, or nothing.
  if (street.length < 3 || city.length < 2) return null;

  // "1234 Palm Ave, Tampa, FL" → "1234-Palm-Ave,-Tampa,-FL"
  const path = [street, city, state]
    .filter(Boolean)
    .join(", ")
    .replace(/\s/g, "-");

  return `https://www.zillow.com/homes/for_rent/${encodeURI(path)}_rb/`;
}
