/**
 * The market table's one rule: what was measured is printed as a
 * measurement, and nothing else is.
 *
 * The catalogue carries a rate, an occupancy and a listing count for
 * every market, all of them generated to make the app look alive
 * before it had data. These pin that none of them can reach the table,
 * and that a market nobody has bought figures for sorts as unknown
 * rather than as zero.
 */

import { describe, expect, it } from "vitest";
import {
  buildRows,
  EMPTY_QUERY,
  filterMarkets,
  isFiltered,
  marketMatches,
  sortMarkets,
  type MeasuredMarket,
} from "./explorer";
import type { Market } from "@/lib/mock/types";

function market(over: Partial<Market> = {}): Market {
  return {
    slug: "jacksonville",
    name: "Jacksonville",
    state: "Florida",
    stateCode: "FL",
    terrain: "coastal",
    lat: 30.33,
    lon: -81.66,
    // Seeded. None of these may appear in a row.
    adr: 999,
    occupancy: 0.99,
    activeListings: 99_999,
    medianRent2br: 1500,
    avgBreakeven2br: 0.4,
    regulation: { status: "permitted", note: "No permit needed.", sourceNote: "city site" },
    monthly: [],
    adrByBedroom: [],
    deltas: { adr: 0, occupancy: 0, listings: 0 },
    ...over,
  } as Market;
}

const measured: MeasuredMarket = {
  adr: 180,
  occupancy: 0.62,
  revenue: 41_000,
  revpar: 112,
  activeListings: 2_400,
  scope: "city",
};

const stats = (entries: [string, MeasuredMarket | null][]) =>
  new Map(
    entries
      .filter((e): e is [string, MeasuredMarket] => e[1] !== null)
      .map(([slug, s]) => [slug, { stats: s, at: "2026-09-01T00:00:00.000Z" }])
  );

describe("what a market row is allowed to say", () => {
  it("prints the vendor's figures and never the catalogue's", () => {
    const [row] = buildRows([market()], stats([["jacksonville", measured]]));
    expect(row.measured).toMatchObject({ adr: 180, occupancy: 0.62, activeListings: 2_400 });
    // The seeded 999 / 0.99 / 99,999 reach nothing.
    expect(JSON.stringify(row)).not.toContain("99999");
    expect(row.measured?.adr).not.toBe(999);
  });

  it("is unmeasured, not zero, when nobody has bought the figures", () => {
    const [row] = buildRows([market()], stats([]));
    expect(row.measured).toBeNull();
    expect(row.spread).toBeNull();
  });

  it("treats a row of nulls as no measurement at all", () => {
    // The vendor answers with the shape whether or not it had figures.
    const empty: MeasuredMarket = {
      adr: null,
      occupancy: null,
      revenue: null,
      revpar: null,
      activeListings: null,
    };
    expect(buildRows([market()], stats([["jacksonville", empty]]))[0].measured).toBeNull();
  });

  it("spreads measured revenue against a year of the estimated lease", () => {
    const [row] = buildRows([market()], stats([["jacksonville", measured]]));
    expect(row.spread).toBe(41_000 - 1_500 * 12);
    expect(row.rentEstimate).toBe(1_500);
  });

  it("carries the rule, which is the column the Deal Finder cannot have", () => {
    const [row] = buildRows([market()], stats([]));
    expect(row.regulation).toEqual({ status: "permitted", note: "No permit needed." });
  });
});

describe("sorting", () => {
  const rows = buildRows(
    [
      market({ slug: "a", name: "Alpha" }),
      market({ slug: "b", name: "Bravo" }),
      market({ slug: "c", name: "Charlie" }),
    ],
    stats([
      ["a", { ...measured, revenue: 30_000 }],
      ["c", { ...measured, revenue: 60_000 }],
    ])
  );

  it("puts the unmeasured last rather than at the bottom of the numbers", () => {
    // A market with no figures is not a market with the lowest ones,
    // and a null sorting as zero buries every measured market.
    expect(sortMarkets(rows, "revenue").map((r) => r.slug)).toEqual(["c", "a", "b"]);
    expect(sortMarkets(rows, "listings").map((r) => r.slug)).toEqual(["a", "c", "b"]);
  });

  it("opens on measured first, biggest year down", () => {
    expect(sortMarkets(rows, "measured").map((r) => r.slug)).toEqual(["c", "a", "b"]);
  });

  it("sorts by name when asked, measured or not", () => {
    expect(sortMarkets(rows, "name").map((r) => r.slug)).toEqual(["a", "b", "c"]);
  });

  it("ranks every market by the estimated rent, which every one has", () => {
    const mixed = buildRows(
      [market({ slug: "cheap", medianRent2br: 900 }), market({ slug: "dear", medianRent2br: 3000 })],
      stats([])
    );
    expect(sortMarkets(mixed, "rent").map((r) => r.slug)).toEqual(["dear", "cheap"]);
  });
});

describe("filtering", () => {
  const rows = buildRows(
    [
      market({ slug: "jax", name: "Jacksonville", stateCode: "FL", terrain: "coastal" }),
      market({
        slug: "denver",
        name: "Denver",
        state: "Colorado",
        stateCode: "CO",
        terrain: "metro",
        regulation: { status: "banned", note: "Primary residence only.", sourceNote: "x" },
      }),
    ],
    stats([["jax", measured]])
  );

  it("matches a name or a state, word by word and in any order", () => {
    expect(marketMatches(rows[0], "jack")).toBe(true);
    expect(marketMatches(rows[0], "florida jack")).toBe(true);
    expect(marketMatches(rows[0], "  ")).toBe(true);
    expect(marketMatches(rows[0], "denver")).toBe(false);
  });

  it("narrows by state, rule and market type", () => {
    expect(filterMarkets(rows, { ...EMPTY_QUERY, states: ["CO"] })).toHaveLength(1);
    expect(filterMarkets(rows, { ...EMPTY_QUERY, rules: ["banned"] })[0].slug).toBe("denver");
    expect(filterMarkets(rows, { ...EMPTY_QUERY, terrain: ["coastal"] })[0].slug).toBe("jax");
  });

  it("can hide everything nobody has measured", () => {
    expect(filterMarkets(rows, { ...EMPTY_QUERY, measuredOnly: true }).map((r) => r.slug)).toEqual([
      "jax",
    ]);
  });

  it("knows when it is doing nothing", () => {
    expect(isFiltered(EMPTY_QUERY)).toBe(false);
    expect(isFiltered({ ...EMPTY_QUERY, query: " " })).toBe(false);
    expect(isFiltered({ ...EMPTY_QUERY, measuredOnly: true })).toBe(true);
  });
});
