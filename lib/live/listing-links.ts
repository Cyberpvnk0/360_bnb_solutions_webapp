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
 * TWO SHAPES, BECAUSE THE PORTALS DIFFER AND PRETENDING OTHERWISE
 * PRODUCES DEAD BUTTONS:
 *
 *   Zillow addresses a property search by the address itself, so that
 *   one is built directly and lands on the listing when it exists.
 *
 *   Redfin addresses a city by an opaque internal id, and Realtor
 *   addresses a property by an internal property id. We hold neither,
 *   and a guessed URL 404s — worse than no button. So those two go
 *   through a web search scoped to the site, which resolves from the
 *   address alone, costs one extra hop, and cannot 404.
 *
 * The alternative for those two was linking to a city page, which is
 * not "view this property" — it is "view this city", dressed up as the
 * thing somebody asked for.
 */

export interface Addressed {
  address: string;
  city: string;
  stateCode: string;
}

export type PortalId = "zillow" | "redfin" | "realtor";

export interface PortalLink {
  id: PortalId;
  label: string;
  href: string;
  /**
   * True when the link lands on the portal itself rather than on a
   * search that finds it. Callers may order by this; nobody should
   * hide it, because a slower route to the right page still beats no
   * route.
   */
  direct: boolean;
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
function parts(place: Addressed): { street: string; city: string; state: string } | null {
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

/** A web search pinned to one site. Resolves from an address alone. */
function siteSearch(site: string, p: { street: string; city: string; state: string }): string {
  // The street line quoted, so a search engine treats it as one phrase
  // rather than as five common words that appear on every page of a
  // property portal.
  const q = `site:${site} "${p.street}" ${p.city} ${p.state}`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

/**
 * Every portal worth offering for this property, best first.
 *
 * Empty when the address is too thin to search on. Callers must render
 * nothing for an empty list: a search for half an address lands on
 * somebody else's house, which looks like a bug and wastes a click.
 */
export function portalLinks(place: Addressed): PortalLink[] {
  const p = parts(place);
  if (!p) return [];

  // "1234 Palm Ave, Tampa, FL" → "1234-Palm-Ave,-Tampa,-FL"
  const zillowSlug = [p.street, p.city, p.state]
    .filter(Boolean)
    .join(", ")
    .replace(/\s/g, "-");

  return [
    {
      id: "zillow",
      label: "Zillow",
      // for_rent, because these are rentals and their default search is
      // for sale — landing on a buy page for a lease is a wrong answer
      // that looks like a right one.
      href: `https://www.zillow.com/homes/for_rent/${encodeURI(zillowSlug)}_rb/`,
      direct: true,
    },
    { id: "redfin", label: "Redfin", href: siteSearch("redfin.com", p), direct: false },
    {
      id: "realtor",
      label: "Realtor.com",
      href: siteSearch("realtor.com", p),
      direct: false,
    },
  ];
}

/** The best single destination, for surfaces with room for one link. */
export function photosHref(place: Addressed): string | null {
  return portalLinks(place)[0]?.href ?? null;
}
