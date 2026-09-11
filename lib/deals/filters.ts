/**
 * What a Deal Finder search IS — the shape, the defaults, and the two
 * questions everything asks of it: is anything narrowed, and does this
 * market match what was typed.
 *
 * PURE, AND IN lib FOR A REASON. This lived in the filter-chip
 * component, which carries "use client" — so the moment a server
 * component needed the contract (to read a search out of the URL), the
 * import came back undefined at module scope and the page 500'd with
 * `TYPE_OPTIONS.map is not a function`. A contract is not a component.
 * components/deals/deal-filters re-exports every name here, so nothing
 * that imported it from there had to change.
 */

import type { PropertyType } from "@/lib/mock/types";

export const TYPE_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: "apartment", label: "Apartment" },
  { value: "house", label: "House" },
  { value: "condo", label: "Condo" },
  { value: "townhome", label: "Townhome" },
];

export const TYPE_LABEL: Record<PropertyType, string> = {
  apartment: "Apartment",
  house: "House",
  condo: "Condo",
  townhome: "Townhome",
};

export interface DealFilters {
  /** Substring match on market name or state. */
  query: string;
  /** Monthly rent bounds; the slider extremes mean "no bound". */
  rentMin: number;
  rentMax: number;
  /**
   * Exact counts to keep; empty = any. 5 means "5 or more", so the
   * top tile stays open-ended without a second field.
   *
   * Chosen over a minimum because a minimum cannot express the search
   * people actually run: someone shopping one-bedroom arbitrage does
   * not want a five-bed on the list, and "1+" hands them every one.
   */
  beds: number[];
  /** Exact counts to keep; empty = any. 5 means "5 or more". */
  baths: number[];
  /** All four checked = everything. */
  types: PropertyType[];
  /** The deal-maker: only listings tagged Furnished (their furnishing
   *  budget can start at $0). First-class, not a keyword. */
  furnishedOnly: boolean;
}

export const DEFAULT_DEAL_FILTERS: DealFilters = {
  query: "",
  rentMin: 500,
  rentMax: 6000,
  beds: [],
  baths: [],
  types: TYPE_OPTIONS.map((t) => t.value),
  furnishedOnly: false,
};

export function isDefaultDealFilters(f: DealFilters): boolean {
  return (
    f.query === "" &&
    f.rentMin === DEFAULT_DEAL_FILTERS.rentMin &&
    f.rentMax === DEFAULT_DEAL_FILTERS.rentMax &&
    f.beds.length === 0 &&
    f.baths.length === 0 &&
    f.types.length === TYPE_OPTIONS.length &&
    !f.furnishedOnly
  );
}

/**
 * Every US state abbreviation, so a two-letter token can be recognised
 * as one rather than treated as three letters of somebody's city.
 */
const STATE_CODES = new Set(
  ("al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms " +
    "mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv " +
    "wi wy dc").split(" ")
);

/**
 * Location matching that survives how people actually type: every
 * word/token of the query must appear in the market's haystack
 * ("name state code aliases", lowercased). "jacksonville florida",
 * "Jacksonville, FL", and plain "jacksonville" all find the same market;
 * "springfield mo" pins down one Springfield.
 *
 * A state abbreviation has to match as a WHOLE WORD, which the plain
 * substring test got wrong in a way nobody would guess: "Portland, OR"
 * also matched Portland, Maine, because "portland" contains an "or",
 * and "Lincoln, NE" also matched Lincoln, New Hampshire, through the
 * "ne" in "new". Two matches instead of one, and the Deal Finder only
 * loads live inventory when a search resolves to exactly one market —
 * so two of the course's own cities silently showed preview rows
 * forever. Anything that isn't a state code still matches as a
 * substring, which is what makes typing half a city name work.
 */
export function marketMatchesQuery(haystack: string, query: string): boolean {
  const tokens = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((t) =>
    STATE_CODES.has(t)
      ? new RegExp(`\\b${t}\\b`).test(haystack)
      : haystack.includes(t)
  );
}
