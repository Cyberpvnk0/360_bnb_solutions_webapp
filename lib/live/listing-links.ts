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
 * FOUR DESTINATIONS, IN ORDER. The button opens the first; the menu
 * beside it offers the rest in this order, and the finder page lists
 * them while it looks.
 *
 *   1. Redfin — the listing's OWN page: the exact property, on the site
 *      that published it. When the row arrived without its URL, the
 *      finder page (/go/listing) asks the site for it by address
 *      (lib/live/redfin-page) and lands on it when the answer comes.
 *
 *   2. Zillow — its address page: zillow.com/homes/<address>_rb/, the
 *      one portal URL that takes a street address. It lands on the
 *      property for nearly every US address, including ones no longer
 *      listed; when it does not, it shows the area, and the reader is
 *      one menu click from the next.
 *
 *   3. Realtor — a search of realtor.com for the address. It exposes no
 *      URL that takes an address: it keys a property by an internal id,
 *      and a guessed URL does not 404 but silently degrades into the
 *      market's page. A quoted, site-scoped search is correct by
 *      construction — the engine holds the address-to-URL index the
 *      portal declines to expose, and the result titles show the reader
 *      whether it found the right place.
 *
 *   4. Google Images — pictures of the full address, as written. The
 *      last resort, and the one that shows the house rather than a page
 *      of links about it.
 */

export interface Addressed {
  address: string;
  city: string;
  stateCode: string;
  /** The listing's own page at its source, when the source told us. */
  sourceUrl?: string;
  /** The ZIP, when known: the listing site's search for it is the
   *  fast way to the page (lib/live/redfin-page). */
  zip?: string;
  /** Where it is, when known: the ZIP can be found under the point. */
  point?: { lat: number; lon: number };
}

/**
 * The query that asks the page lookup (app/api/listing-page, and the
 * contact route beside it) about a place: the address it must match,
 * and the ZIP and point that tell it where to look.
 */
export function pageQuery(place: Addressed): URLSearchParams {
  const query = new URLSearchParams({
    address: place.address,
    city: place.city,
    state: place.stateCode,
  });
  if (place.zip && /^\d{5}$/.test(place.zip)) query.set("zip", place.zip);
  if (place.point && Number.isFinite(place.point.lat) && Number.isFinite(place.point.lon)) {
    query.set("lat", String(place.point.lat));
    query.set("lon", String(place.point.lon));
  }
  return query;
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

/** The ZIP, when the place carries a real one. */
function zipOf(place: Addressed): string | null {
  return place.zip && /^\d{5}$/.test(place.zip) ? place.zip : null;
}

/**
 * A source URL we will actually send somebody to.
 *
 * Only ever https, and only ever to the listing site itself: this
 * string was read off a vendor payload, and a payload is not a place to
 * take a navigation target from on trust. Anything else falls through
 * to the finder and the portals behind it.
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
 * the lister's details are certain to be. The finder that stands in
 * otherwise looks for the property rather than opening it, so copy that
 * promises the lister must check this first.
 */
export function hasOwnListingPage(place: Addressed): boolean {
  return usableListingPage(place.sourceUrl) !== null;
}

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
 * The two words that pin a search to this property, quoted, and
 * nothing else. An earlier cut quoted the whole street line, and the
 * line it was handed came from a geocoder that writes "1804 East Sitka
 * Street" while the portal's page says "1804 E Sitka St": an
 * exact-phrase search for the one cannot match the other, and the
 * engine answered that nothing matched — for a listing that was there.
 * The house number and the street's own name are written the same way
 * everywhere; the directional, the suffix and the unit are not, so
 * they stay out. A line with no number — a named building — is quoted
 * whole, since there is nothing else to hold it to.
 */
function pin(street: string): string {
  const { number, name } = searchTerms(street);
  return number && name ? `"${number}" "${name}"` : `"${street}"`;
}

function googleHref(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
}

/**
 * The property's address page on Zillow: the words of the address, the
 * town, the state and the ZIP, joined with dashes, the way their own
 * search writes it. A unit marked "#4B" is written "APT 4B", which is
 * how their pages spell a flat; a "#" would start a fragment anyway.
 */
export function zillowHref(place: Addressed): string | null {
  const p = parts(place);
  if (!p) return null;
  const street = (place.address ?? "")
    .replace(/#\s*([\p{L}\p{N}-]+)/gu, "APT $1")
    // A flat's marker the way their pages spell it, whichever way the
    // feed wrote it.
    .replace(/\b(apartment|apt)\b\.?/giu, "APT")
    .replace(/\b(suite|ste)\b\.?/giu, "STE")
    .replace(/\bunit\b\.?/giu, "UNIT");
  const words = [street, p.city, p.state, zipOf(place) ?? ""]
    .join(" ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 3) return null;
  return `https://www.zillow.com/homes/${words.join("-")}_rb/`;
}

/** A search of one listing site for this exact property. */
export function siteSearchHref(place: Addressed, site: "realtor.com"): string | null {
  const p = parts(place);
  if (!p) return null;
  return googleHref(`${pin(p.street)} ${p.city} ${p.state} site:${site}`);
}

/** Google's image search for the full address, as written. */
export function addressSearchHref(place: Addressed): string | null {
  const p = parts(place);
  if (!p) return null;
  const zip = zipOf(place);
  const query = `${p.street}, ${p.city}, ${p.state}${zip ? ` ${zip}` : ""}`;
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
}

/**
 * The finder page for an address whose listing page is not in hand:
 * /go/listing opens at once, asks the listing site, and lands on the
 * listing when the answer comes — or on the next destination in order
 * when there is no page. A click during the lookup lands where the
 * link would have, rather than somewhere else because it came early.
 */
export function findingHref(place: Addressed): string | null {
  const p = parts(place);
  if (!p) return null;
  const query = pageQuery({
    ...place,
    address: p.street,
    city: p.city,
    stateCode: p.state,
  });
  return `/go/listing?${query}`;
}

/**
 * A web search for the property's rental, for a panel that could get
 * no contact off a listing page: not among the listing site's rentals,
 * or a page that could not be read, or one that publishes none. Not
 * scoped to a site — the point is every other place the rental is
 * advertised, where the number usually is — and biased to rental
 * pages by the phrase. The reader was going to search anyway; this
 * types it for them.
 */
export function webLookupHref(place: Addressed): string | null {
  const p = parts(place);
  if (!p) return null;
  return googleHref(`${pin(p.street)} ${p.city} ${p.state} for rent`);
}

/** Which destination a link goes to, so the label can say so. A
 *  search finds the listing; it does not open it, and copy that
 *  claims otherwise spends the reader's click on a surprise. "finding"
 *  is the listing, by way of the finder page. */
export type PhotosLinkKind = "listing" | "search" | "finding";

export type PhotoSourceId = "redfin" | "zillow" | "realtor" | "google";

export interface PhotoSource {
  id: PhotoSourceId;
  /** The name on the menu. */
  label: string;
  href: string;
  kind: PhotosLinkKind;
}

export interface PhotosDestination {
  href: string;
  kind: PhotosLinkKind;
}

/**
 * Where to see this property's photos: every destination we can build,
 * in the order of preference the module header sets out. Empty when we
 * have too little of an address to send anyone anywhere — and empty is
 * a real answer that callers must render nothing for: a search for half
 * an address returns other people's houses, which looks like a bug and
 * wastes a click.
 */
export function photoSources(place: Addressed): PhotoSource[] {
  const out: PhotoSource[] = [];
  const own = usableListingPage(place.sourceUrl);
  if (own) {
    out.push({ id: "redfin", label: "Redfin", href: own, kind: "listing" });
  } else {
    const finding = findingHref(place);
    if (finding) out.push({ id: "redfin", label: "Redfin", href: finding, kind: "finding" });
  }
  const zillow = zillowHref(place);
  if (zillow) out.push({ id: "zillow", label: "Zillow", href: zillow, kind: "search" });
  const realtor = siteSearchHref(place, "realtor.com");
  if (realtor) out.push({ id: "realtor", label: "Realtor", href: realtor, kind: "search" });
  const google = addressSearchHref(place);
  if (google) out.push({ id: "google", label: "Google", href: google, kind: "search" });
  return out;
}

/**
 * Where a "View photos" click goes: the first of the destinations —
 * the listing itself when the row carries it, the finder that looks
 * for it otherwise. Null when there is nowhere to send anyone.
 */
export function photosLink(place: Addressed): PhotosDestination | null {
  const [first] = photoSources(place);
  return first ? { href: first.href, kind: first.kind } : null;
}

/** The href alone, for callers that don't render a label. */
export function photosHref(place: Addressed): string | null {
  return photosLink(place)?.href ?? null;
}
