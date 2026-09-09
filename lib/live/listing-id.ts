/**
 * Whether a platform listing id can be trusted to be the listing's.
 *
 * Airbnb's newer ids run to nineteen digits — past 2^53, the last
 * integer a JavaScript number (or any double) holds exactly. An id
 * that passed through a double anywhere — in this process before the
 * comps parser learned to keep them, or in the vendor's own pipeline —
 * comes out as the shortest decimal that names its nearest double:
 * "1482756537092586000" for a listing that was 1482756537092586123.
 * A room link built from that opens the platform's "something went
 * wrong" page, and a link that is usually wrong is worse than none.
 *
 * The test is exact rather than "ends in zeros": an id is rounded
 * when it is itself the shortest round-trip form of the double nearest
 * it. A real nineteen-digit id has almost no chance of being that (its
 * nearest double prints as a different string), so exact ids keep
 * their links and rounded ones lose them.
 *
 * Client-safe: no vendor, no key, pure arithmetic.
 */
export function looksRoundedId(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  const n = Number(digits);
  if (Number.isSafeInteger(n)) return false;
  return String(n) === digits;
}

/** The trailing numeric id of a platform page URL, if it has one. */
function trailingId(url: string): string | null {
  const m = /\/(\d{5,})\/?(?:[?#].*)?$/.exec(url);
  return m ? m[1] : null;
}

/** Whether a listing page URL ends in an id that looks rounded. */
export function urlIdLooksRounded(url: string): boolean {
  const id = trailingId(url);
  return id !== null && looksRoundedId(id);
}

/**
 * Whether a stored comp carries a rounded id anywhere a link would be
 * built from — its own page URL, or the platform id inside its
 * "sc-live-<id>" identity.
 */
export function compIdLooksRounded(comp: {
  id: string;
  listingUrl?: string;
}): boolean {
  if (comp.listingUrl && urlIdLooksRounded(comp.listingUrl)) return true;
  const m = /^sc-live-(\d{5,})$/.exec(comp.id);
  return m !== null && looksRoundedId(m[1]);
}
