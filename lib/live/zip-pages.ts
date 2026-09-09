/**
 * The listing site's rentals in one ZIP, keyed by address: the fast
 * way from an address to its page.
 *
 * A row that arrived without its listing page — most of a big market's,
 * every typed address — used to ask the site's address lookup for it,
 * through a proxy tier that on this domain takes twenty seconds on a
 * good day and often never answers. The site's SEARCH goes through the
 * vendor's structured endpoint instead, which handles the site's bot
 * protection itself and has been dependable — it is what the Furnished
 * filter and the market join ride. A ZIP's rentals are a few pages of
 * that search; read once, they answer for every address in the ZIP.
 *
 * Read once a day per ZIP, for everyone: the rows are kept in the
 * shared store, and a ZIP the rentals feed was just asked about is read
 * behind that response so the pages are there before anyone opens a
 * row. The cap on pages is high enough that a ZIP is usually read
 * whole, and `complete` says whether it was — an address absent from a
 * ZIP read whole is not among the site's rentals, which is an answer;
 * absent from a ZIP read in part is merely not yet found.
 *
 * What is kept is an address and a URL per row: the two things the join
 * reads, and nothing off a listing.
 */

import { addressKey } from "./address";
import { indexBySite, type ListingFacts } from "./listing-join";
import {
  fetchRedfinSearchRows,
  siteRowsFrom,
  zipRentalsUrl,
  type SiteRow,
} from "./redfin";
import { isFresh, readKeyedBlob, writeKeyed } from "@/lib/db/market-store";

/** A day: rental inventory turns over. */
export const ZIP_PAGES_TTL_MS = 24 * 60 * 60 * 1000;

/** About four hundred rows. Most ZIPs are read whole well inside it;
 *  a dense downtown ZIP is not, and says so. */
export const ZIP_PAGE_LIMIT = 10;

export interface ZipPages {
  zip: string;
  /** By lib/live/address's key: the building, and the unit when named. */
  index: Map<string, ListingFacts>;
  rows: number;
  pages: number;
  /** True when every page of the ZIP's search was read. */
  complete: boolean;
  from: "store" | "site";
}

interface StoredZipPages {
  rows: SiteRow[];
  pages: number;
  complete: boolean;
}

function storeKey(zip: string): string {
  return `zip-pages:v1:${zip}`;
}

function fromStored(value: unknown): StoredZipPages | null {
  const v = value as Partial<StoredZipPages> | null;
  if (!v || typeof v !== "object" || !Array.isArray(v.rows)) return null;
  const rows = v.rows.filter(
    (r): r is SiteRow =>
      !!r &&
      typeof r === "object" &&
      typeof (r as SiteRow).address === "string" &&
      (typeof (r as SiteRow).sourceUrl === "string" || (r as SiteRow).sourceUrl === undefined)
  );
  return {
    rows,
    pages: typeof v.pages === "number" ? v.pages : 0,
    complete: v.complete === true,
  };
}

function toPages(zip: string, value: StoredZipPages, from: ZipPages["from"]): ZipPages {
  return {
    zip,
    index: indexBySite(value.rows),
    rows: value.rows.length,
    pages: value.pages,
    complete: value.complete,
    from,
  };
}

/** The ZIP's rows from the store, when they are there and fresh. Never
 *  asks the site: the request path reads this, and the site is asked
 *  behind the response. */
export async function readZipPagesStored(zip: string): Promise<ZipPages | null> {
  if (!/^\d{5}$/.test(zip)) return null;
  const stored = await readKeyedBlob(storeKey(zip)).catch(() => null);
  if (!stored || !isFresh(stored.at, ZIP_PAGES_TTL_MS)) return null;
  const value = fromStored(stored.value);
  return value ? toPages(zip, value, "store") : null;
}

/** Reads under way in this process, so two rows of one ZIP opened in
 *  the same moment read it once. */
const inFlight = new Map<string, Promise<ZipPages | null>>();

/**
 * The ZIP's rows: from the store, or from the site and then stored.
 * Null when the site could not be read — which says nothing about the
 * ZIP, and is not stored.
 */
export async function readZipPages(zip: string): Promise<ZipPages | null> {
  if (!/^\d{5}$/.test(zip)) return null;
  const stored = await readZipPagesStored(zip);
  if (stored) return stored;
  const running = inFlight.get(zip);
  if (running) return running;
  const job = readFromSite(zip).finally(() => inFlight.delete(zip));
  inFlight.set(zip, job);
  return job;
}

async function readFromSite(zip: string): Promise<ZipPages | null> {
  try {
    const walk = await fetchRedfinSearchRows(zipRentalsUrl(zip), ZIP_PAGE_LIMIT);
    // Not JSON is not a ZIP with no rentals: an answer in a shape this
    // does not read is nothing to keep.
    if (!walk.parsed) return null;
    const value: StoredZipPages = {
      rows: siteRowsFrom(walk.raw),
      pages: walk.pages,
      complete: !walk.morePages,
    };
    void writeKeyed(storeKey(zip), value).catch(() => undefined);
    return toPages(zip, value, "site");
  } catch {
    return null;
  }
}

/** The page for exactly this address among the ZIP's rows, or null. */
export function pageInZip(pages: ZipPages, address: string): string | null {
  const key = addressKey(address);
  if (!key) return null;
  return pages.index.get(key)?.sourceUrl ?? null;
}
