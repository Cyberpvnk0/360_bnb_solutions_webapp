/**
 * The Deal Finder's search, written into the URL.
 *
 * A refresh used to throw the whole search away — the location, every
 * filter, the sort — and drop somebody back on "Where are you hunting?"
 * after they had narrowed four hundred rentals to eleven. Which is what
 * a URL is for: the address bar IS the state, so a refresh restores it,
 * back and forward walk it, and a search can be sent to somebody else.
 *
 * ONLY WHAT DIFFERS FROM THE DEFAULT GOES IN. A URL carrying every
 * filter at its resting value is unreadable and unshareable, and it
 * makes "is anything filtered?" a question about string length. An
 * untouched Deal Finder has a bare /deals.
 *
 * Pure on purpose: the explorer writes these params and the page reads
 * them, and the two agreeing is the whole feature. Tested against each
 * other in search-url.test.ts rather than by loading a page.
 */

import {
  DEFAULT_DEAL_FILTERS,
  TYPE_OPTIONS,
  type DealFilters,
} from "@/lib/deals/filters";
import type { PropertyType } from "@/lib/mock/types";

/** Everything the Deal Finder restores. */
export interface DealSearch {
  /** The location box: a market name, or "" when a ZIP is the search. */
  query: string;
  /** A 5-digit ZIP search, which is its own mode. */
  zip: string | null;
  filters: DealFilters;
  sort: string;
  /** A saved list the grid is narrowed to. */
  list: string | null;
  /** A rental whose panel should open. */
  listing: string | null;
}

export const DEFAULT_SORT = "spread";

const TYPE_VALUES = TYPE_OPTIONS.map((t) => t.value);
const ALL_TYPES = new Set<string>(TYPE_VALUES);

/** Comma-joined small ints, e.g. beds=2,3. */
function numbers(value: string | null): number[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((n) => Number.parseInt(n, 10))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 20)
    ),
  ].sort((a, b) => a - b);
}

function money(value: string | null, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? n : fallback;
}

/**
 * The search a URL describes, with anything absent or malformed
 * falling back to the default. A hand-edited URL degrades to a wider
 * search — never to an error page.
 */
export function searchFromParams(
  get: (key: string) => string | null | undefined
): DealSearch {
  const read = (k: string) => {
    const v = get(k);
    return typeof v === "string" && v.length > 0 ? v : null;
  };
  const zipRaw = read("zip");
  const types = (read("types") ?? "")
    .split(",")
    .filter((t): t is PropertyType => ALL_TYPES.has(t));
  const listing = read("listing");
  return {
    query: read("q") ?? "",
    zip: zipRaw && /^\d{5}$/.test(zipRaw) ? zipRaw : null,
    filters: {
      // The location lives in `query` on the search, not in the
      // filters' own copy of it — the explorer holds one string and
      // this is it.
      query: read("q") ?? "",
      rentMin: money(read("rentMin"), DEFAULT_DEAL_FILTERS.rentMin),
      rentMax: money(read("rentMax"), DEFAULT_DEAL_FILTERS.rentMax),
      beds: numbers(read("beds")),
      baths: numbers(read("baths")),
      types: types.length > 0 ? types : DEFAULT_DEAL_FILTERS.types,
      furnishedOnly: read("furnished") === "1",
    },
    sort: read("sort") ?? DEFAULT_SORT,
    list: read("list"),
    listing: listing && listing.length <= 200 ? listing : null,
  };
}

/**
 * The URL for a search: only the parts that differ from an untouched
 * Deal Finder, in a fixed order so the same search is the same string.
 */
export function searchToParams(search: DealSearch): URLSearchParams {
  const params = new URLSearchParams();
  const f = search.filters;
  if (search.zip) params.set("zip", search.zip);
  else if (search.query.trim()) params.set("q", search.query.trim());
  if (f.rentMin !== DEFAULT_DEAL_FILTERS.rentMin) {
    params.set("rentMin", String(f.rentMin));
  }
  if (f.rentMax !== DEFAULT_DEAL_FILTERS.rentMax) {
    params.set("rentMax", String(f.rentMax));
  }
  if (f.beds.length > 0) params.set("beds", f.beds.join(","));
  if (f.baths.length > 0) params.set("baths", f.baths.join(","));
  if (f.types.length !== TYPE_VALUES.length) params.set("types", f.types.join(","));
  if (f.furnishedOnly) params.set("furnished", "1");
  if (search.sort !== DEFAULT_SORT) params.set("sort", search.sort);
  if (search.list) params.set("list", search.list);
  if (search.listing) params.set("listing", search.listing);
  return params;
}

/** The path to write into the address bar — bare /deals when nothing
 *  has been narrowed, so an untouched page has an untouched URL. */
export function searchToHref(search: DealSearch, path = "/deals"): string {
  const qs = searchToParams(search).toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * The filters alone, reset — the location, the ZIP, the saved list and
 * the sort all survive.
 *
 * "Reset filters" used to clear the search as well, which meant the one
 * control for undoing a bed count also undid the ten seconds somebody
 * spent finding the city.
 */
export function clearedFilters(current: DealFilters): DealFilters {
  return { ...DEFAULT_DEAL_FILTERS, query: current.query };
}
