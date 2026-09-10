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
 * A READ THAT FAILS SAYS HOW. Whether the vendor refused, throttled,
 * answered in a shape this does not read, or answered with no rows,
 * the failure is spelled out for whoever reads the route's answer —
 * vendor prose and key names only, never a value off a listing — and
 * nothing is kept, so a bad day is not remembered as an empty ZIP.
 *
 * What is kept is an address and a URL per row: the two things the join
 * reads, and nothing off a listing.
 */

import { addressKey } from "./address";
import { indexBySite, type ListingFacts } from "./listing-join";
import {
  RedfinError,
  fetchRedfinSearchRows,
  siteRowsFrom,
  zipRentalsUrls,
  type SiteRow,
} from "./redfin";
import { isFresh, readKeyedBlob, writeKeyed } from "@/lib/db/market-store";

/** A day: rental inventory turns over. */
export const ZIP_PAGES_TTL_MS = 24 * 60 * 60 * 1000;

/** About four hundred rows. Most ZIPs are read whole well inside it;
 *  a dense downtown ZIP is not, and says so. */
export const ZIP_PAGE_LIMIT = 10;

/** A read that failed is not tried again for this long, per process:
 *  a burst of opens in one ZIP must not become a burst of failed
 *  vendor requests. Short, because the cause is often a throttle. */
const FAILURE_MEMORY_MS = 2 * 60 * 1000;

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

export type ZipPagesRead =
  | { ok: true; pages: ZipPages }
  | {
      ok: false;
      /** What each attempt came back with, for the person reading the
       *  route's answer. Vendor prose and key names, never a value off
       *  a listing. */
      detail: string;
    };

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
const inFlight = new Map<string, Promise<ZipPagesRead>>();
/** Reads that failed, and when — see FAILURE_MEMORY_MS. */
const failures = new Map<string, { at: number; detail: string }>();

/**
 * The ZIP's rows: from the store, or from the site and then stored.
 * A failure says why, and is not stored: it says nothing about the ZIP.
 */
export async function readZipPages(zip: string): Promise<ZipPagesRead> {
  if (!/^\d{5}$/.test(zip)) return { ok: false, detail: "not a five-digit ZIP" };
  const stored = await readZipPagesStored(zip);
  if (stored) return { ok: true, pages: stored };
  const recent = failures.get(zip);
  if (recent && Date.now() - recent.at < FAILURE_MEMORY_MS) {
    return { ok: false, detail: `${recent.detail} (a moment ago; not asked again yet)` };
  }
  const running = inFlight.get(zip);
  if (running) return running;
  const job = readFromSite(zip).finally(() => inFlight.delete(zip));
  inFlight.set(zip, job);
  return job;
}

function describe(error: unknown): string {
  if (error instanceof RedfinError) {
    const status = error.status ? ` ${error.status}` : "";
    const said = error.detail ? `: ${error.detail.slice(0, 160)}` : "";
    return `${error.reason}${status}${said}`;
  }
  return error instanceof Error ? error.message : "failed";
}

/** The shape of an answer with no rows in it — key names, never values. */
function shapeOf(body: unknown): string {
  if (Array.isArray(body)) return `an array of ${body.length}`;
  if (!body || typeof body !== "object") return `${body === null ? "null" : typeof body}`;
  const keys = Object.keys(body);
  return `an object with ${keys.length} key${keys.length === 1 ? "" : "s"}${
    keys.length > 0 ? `: ${keys.slice(0, 8).join(", ")}` : ""
  }`;
}

async function readFromSite(zip: string): Promise<ZipPagesRead> {
  const notes: string[] = [];
  for (const url of zipRentalsUrls(zip)) {
    const slug = url.slice(url.lastIndexOf("/") + 1);
    try {
      const walk = await fetchRedfinSearchRows(url, ZIP_PAGE_LIMIT);
      if (!walk.parsed) {
        notes.push(`${slug}: not JSON`);
        continue;
      }
      // No rows is far more often a page in a shape this does not read
      // than a ZIP with no rentals. Nothing is kept, and the answer says
      // what came back, so the shape can be read off it.
      if (walk.raw.length === 0) {
        notes.push(`${slug}: no rows, in ${shapeOf(walk.body)}`);
        continue;
      }
      const rows = siteRowsFrom(walk.raw);
      if (rows.length === 0) {
        notes.push(`${slug}: ${walk.raw.length} rows, none with an address and a page`);
        continue;
      }
      const value: StoredZipPages = {
        rows,
        pages: walk.pages,
        complete: !walk.morePages,
      };
      void writeKeyed(storeKey(zip), value).catch(() => undefined);
      return { ok: true, pages: toPages(zip, value, "site") };
    } catch (e) {
      notes.push(`${slug}: ${describe(e)}`);
      // A throttle will not have cleared for the next shape either.
      if (e instanceof RedfinError && e.reason === "quota") break;
    }
  }
  const detail = notes.join("; ");
  failures.set(zip, { at: Date.now(), detail });
  return { ok: false, detail };
}

/** The page for exactly this address among the ZIP's rows, or null. */
export function pageInZip(pages: ZipPages, address: string): string | null {
  const key = addressKey(address);
  if (!key) return null;
  return pages.index.get(key)?.sourceUrl ?? null;
}

/** Tests only. */
export function resetZipPagesMemory(): void {
  inFlight.clear();
  failures.clear();
}
