/**
 * The ZIP a listing sits in.
 *
 * A ZIP search must show that ZIP and nothing else, whatever else is
 * filtered. The furnished set in particular is bought a city at a time
 * — the portal answers Furnished at its city search, and a ZIP is not a
 * city — so it has to be cut down to the ZIP here, on the way to the
 * screen. The feeds carry the ZIP two ways: a field of its own on some
 * rows, and the postal tail of the address line on most. Both are
 * read. A row with neither is not KNOWN to be in the ZIP and stays out
 * of a ZIP search, because "probably nearby" is not what was typed.
 *
 * Client-safe: pure string work.
 */

/** The five-digit ZIP at the end of a postal address line, if any. */
export function zipFromAddress(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const m = /\b(\d{5})(?:-\d{4})?\s*$/.exec(address.trim());
  return m ? m[1] : undefined;
}

export function zipOf(listing: { zip?: string; address: string }): string | undefined {
  return listing.zip ?? zipFromAddress(listing.address);
}

/** Whether a listing is in the ZIP that was searched. */
export function inZip(listing: { zip?: string; address: string }, zip: string): boolean {
  return zipOf(listing) === zip;
}
