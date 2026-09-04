/**
 * Putting a rental row together with its page on the listing site.
 *
 * The rentals feed knows about far more inventory than any one portal's
 * search does, and it knows nothing about where that inventory is
 * PUBLISHED. So a row arrives with an address, a rent and no way to see
 * the property. This joins it to the listing site's own search for the
 * same market and takes exactly two things off the match:
 *
 *   1. The listing's page URL, so "View photos" opens that property
 *      rather than a search that lands near it.
 *   2. The contact the listing publishes, so somebody can ring the
 *      person letting it.
 *
 * Neither is a photograph, and that distinction is the whole reason
 * this is allowed to exist where the old photo merge was not: a page
 * URL is a pointer and a phone number is a fact, while a photograph is
 * somebody's copyrighted work. The pictures stay where they were
 * published, and this sends people there.
 *
 * STRICT MATCHING, DELIBERATELY. lib/live/address reduces both sides to
 * a key that sees through "Street" against "St" and keeps unit 1 apart
 * from unit 2. A near-miss stays unmatched and the row keeps its
 * fallback link, because the failure that matters here is not a missing
 * phone number — it is a stranger's phone number under somebody's
 * address, which reads as fact and gets dialled.
 */

import { addressKey } from "@/lib/live/address";
import type { ListingContact, RentalListing } from "@/lib/mock/types";

/** What a matched listing page can tell us about a row. */
export interface ListingFacts {
  sourceUrl?: string;
  contact?: ListingContact;
}

/**
 * The listing site's rows, keyed for lookup.
 *
 * Built once per market rather than per row: a market is hundreds of
 * listings on each side, and scanning one against the other is the
 * quadratic that made an earlier version of this time out.
 */
export function indexBySite(rows: readonly RentalListing[]): Map<string, ListingFacts> {
  const out = new Map<string, ListingFacts>();
  for (const row of rows) {
    const key = addressKey(row.address);
    if (!key) continue;
    // The first row to claim an address keeps it. Two listings for the
    // same unit is a relist, and the newer one is already first in the
    // feed's own order.
    if (out.has(key)) continue;
    if (!row.sourceUrl && !row.contact) continue;
    out.set(key, { sourceUrl: row.sourceUrl, contact: row.contact });
  }
  return out;
}

/**
 * Rows with whatever the listing site could tell us folded in.
 *
 * Never overwrites what a row already had: the feed's own contact, on
 * the rare row that carries one, is about the unit rather than about
 * whoever happens to hold the listing today.
 */
export function joinListingFacts(
  rows: readonly RentalListing[],
  index: Map<string, ListingFacts>
): RentalListing[] {
  if (index.size === 0) return rows as RentalListing[];
  return rows.map((row) => {
    const key = addressKey(row.address);
    const found = key ? index.get(key) : undefined;
    if (!found) return row;
    const sourceUrl = row.sourceUrl ?? found.sourceUrl;
    const contact = row.contact ?? found.contact;
    if (sourceUrl === row.sourceUrl && contact === row.contact) return row;
    return { ...row, sourceUrl, contact };
  });
}

/**
 * Whether a set of rows has ever been through this join.
 *
 * ZERO coverage is the signal, deliberately, and the distinction
 * matters more than it looks. The portal never carries all of a
 * market — its search paginates where the feed does not — so "enough
 * rows have a page" is a test that never passes and would re-run the
 * join on every request forever. "Any row has a page" is a test that
 * passes the moment the join has run once, which is exactly the
 * question being asked: has this set been offered to the join at all.
 *
 * It exists because rows written to the store before the join shipped
 * are served straight back out of it, and never pass through the join
 * on their way. That is what made twenty properties in a row fall back
 * to a search link — not a matcher that missed, but a join that was
 * never given the rows.
 */
export function needsListingPages(rows: readonly RentalListing[]): boolean {
  return rows.length > 0 && !rows.some((r) => r.sourceUrl);
}

/** How well the two sides met, for the diagnostics that pay for this. */
export function joinCoverage(
  rows: readonly RentalListing[]
): { rows: number; withPage: number; withContact: number } {
  return {
    rows: rows.length,
    withPage: rows.filter((r) => r.sourceUrl).length,
    withContact: rows.filter((r) => r.contact).length,
  };
}
