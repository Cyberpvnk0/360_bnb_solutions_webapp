/**
 * The market explorer's row model — and the rule that decides what it
 * is allowed to say.
 *
 * ONLY WHAT WAS MEASURED IS PRINTED AS A MEASUREMENT. The catalogue
 * carries a rate, an occupancy and a listing count for all four hundred
 * markets, and every one of those was generated to make the app look
 * alive before it had data. A table that prints them beside the
 * genuinely measured ones is a table where nobody can tell which is
 * which, and this product's whole claim is that its figures came from
 * somewhere. So the performance columns read from the vendor's stored
 * rows and from nowhere else; a market nobody has bought figures for
 * shows a dash and says so.
 *
 * What the catalogue IS good for is the things it was researched for
 * rather than generated: where the market is, what kind of place it is,
 * and what the local rule on nightly letting is. Those print for every
 * market, and for an arbitrage operator the rule is the first question
 * anyway.
 *
 * The lease side is the one estimate that earns its place. A spread
 * needs both halves and nobody publishes a median lease per market for
 * free, so the catalogue's figure stands in, labelled, the same way the
 * analyzer labels it when a typed address has no listing behind it.
 */

import type {
  Market,
  MarketTerrain,
  RegulationStatus,
} from "@/lib/mock/types";

/** What the vendor measured for a market, as the store keeps it. */
export interface MeasuredMarket {
  adr: number | null;
  occupancy: number | null;
  revenue: number | null;
  revpar: number | null;
  activeListings: number | null;
  /** "zip" covers the ZIP the market's centre falls in, "city" the
   *  whole locality. Different areas, so a row says which. */
  scope?: "zip" | "city";
}

export interface MarketRow {
  slug: string;
  name: string;
  state: string;
  stateCode: string;
  terrain: MarketTerrain;
  /** Where it is, for the map. */
  lat: number;
  lon: number;
  regulation: { status: RegulationStatus; note: string };
  /** Null until somebody's analysis paid for this market's figures. */
  measured: (MeasuredMarket & { at: string | null }) | null;
  /** The catalogue's median asking lease for a two-bedroom. An
   *  estimate, and labelled as one everywhere it shows. */
  rentEstimate: number;
  /**
   * A year of measured letting revenue less a year of that lease.
   *
   * Null without a measured revenue: half a spread is not a spread.
   * Part measured and part estimated even when it is there, which is
   * why the column carries the caveat rather than the reader.
   */
  spread: number | null;
}

export function buildRows(
  markets: readonly Market[],
  stats: ReadonlyMap<string, { stats: MeasuredMarket; at: string | null }>
): MarketRow[] {
  return markets.map((m) => {
    const hit = stats.get(m.slug);
    // A row of nulls is not a measurement. The vendor answers with the
    // shape whether or not it had figures, so "measured" means at least
    // one figure came back.
    const measured =
      hit &&
      (hit.stats.adr !== null ||
        hit.stats.occupancy !== null ||
        hit.stats.revenue !== null ||
        hit.stats.activeListings !== null)
        ? { ...hit.stats, at: hit.at }
        : null;
    const revenue = measured?.revenue ?? null;
    return {
      slug: m.slug,
      name: m.name,
      state: m.state,
      stateCode: m.stateCode,
      terrain: m.terrain,
      lat: m.lat,
      lon: m.lon,
      regulation: { status: m.regulation.status, note: m.regulation.note },
      measured,
      rentEstimate: m.medianRent2br,
      spread: revenue === null ? null : Math.round(revenue - m.medianRent2br * 12),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Filtering                                                           */
/* ------------------------------------------------------------------ */

export interface MarketQuery {
  /** Name or state, loosely matched. */
  query: string;
  /** Empty means every state. Overlaps the search box, which also
   *  matches a state — the box is for one you can spell and the chip
   *  for picking several off a list. */
  states: string[];
  rules: RegulationStatus[];
  terrain: MarketTerrain[];
}

export const EMPTY_QUERY: MarketQuery = {
  query: "",
  states: [],
  rules: [],
  terrain: [],
};

function loose(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function marketMatches(row: MarketRow, query: string): boolean {
  const q = loose(query);
  if (!q) return true;
  const hay = loose(`${row.name} ${row.state} ${row.stateCode}`);
  // Every word, in any order: "beach fl" finds a Florida beach market.
  return q.split(" ").every((word) => hay.includes(word));
}

export function filterMarkets(
  rows: readonly MarketRow[],
  q: MarketQuery
): MarketRow[] {
  return rows.filter((row) => {
    if (q.states.length > 0 && !q.states.includes(row.stateCode)) return false;
    if (q.rules.length > 0 && !q.rules.includes(row.regulation.status)) return false;
    if (q.terrain.length > 0 && !q.terrain.includes(row.terrain)) return false;
    return marketMatches(row, q.query);
  });
}

export function isFiltered(q: MarketQuery): boolean {
  return (
    q.query.trim() !== "" ||
    q.states.length > 0 ||
    q.rules.length > 0 ||
    q.terrain.length > 0
  );
}

/* ------------------------------------------------------------------ */
/* Sorting                                                             */
/* ------------------------------------------------------------------ */

export type MarketSort =
  | "revenue"
  | "adr"
  | "occupancy"
  | "listings"
  | "spread"
  | "rent"
  | "name";

const VALUE: Record<Exclude<MarketSort, "name">, (r: MarketRow) => number | null> = {
  revenue: (r) => r.measured?.revenue ?? null,
  adr: (r) => r.measured?.adr ?? null,
  occupancy: (r) => r.measured?.occupancy ?? null,
  listings: (r) => r.measured?.activeListings ?? null,
  spread: (r) => r.spread,
  rent: (r) => r.rentEstimate,
};

/**
 * Sort, with the unmeasured always last.
 *
 * A market with no figures is not a market with the lowest figures, and
 * letting a null sort as a zero would bury every measured market under
 * three hundred blanks the moment somebody sorted by revenue. It is
 * also why there is no "measured first" preset: every figure sort
 * already puts them first, and a preset for it was a second name for
 * what the other six do.
 */
export function sortMarkets(rows: readonly MarketRow[], sort: MarketSort): MarketRow[] {
  const out = [...rows];
  const byName = (a: MarketRow, b: MarketRow) =>
    a.name.localeCompare(b.name) || a.stateCode.localeCompare(b.stateCode);

  if (sort === "name") return out.sort(byName);
  const read = VALUE[sort];
  return out.sort((a, b) => {
    const x = read(a);
    const y = read(b);
    if (x === null && y === null) return byName(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x || byName(a, b);
  });
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

/**
 * How strict the local rule is, in the one word an operator scanning a
 * list actually wants. "Moderate" is not a hedge — it is the honest
 * word for a market that allows nightly letting but gates it behind a
 * permit, and collapsing it into either neighbour would misstate the
 * rule for a few hundred cities.
 */
export const RULE_LABEL: Record<RegulationStatus, string> = {
  permitted: "Lenient",
  "permit-required": "Moderate",
  banned: "Strict",
  unverified: "Unverified",
};

/** Gold for the rule an operator wants, red for the one that ends the
 *  conversation, and plain for the two in between. */
export const RULE_TONE: Record<RegulationStatus, "gold" | "neutral" | "neg" | "outline"> = {
  permitted: "gold",
  "permit-required": "neutral",
  banned: "neg",
  unverified: "outline",
};

export const TERRAIN_LABEL: Record<MarketTerrain, string> = {
  metro: "Metro",
  coastal: "Coastal",
  mountain: "Mountain",
  desert: "Desert",
};

export const RULE_ORDER: RegulationStatus[] = [
  "permitted",
  "permit-required",
  "unverified",
  "banned",
];

export const TERRAIN_ORDER: MarketTerrain[] = ["metro", "coastal", "mountain", "desert"];
