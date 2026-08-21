import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  isDefaultFilters,
  matchesFilters,
  type ExplorerFilters,
  type Sortable,
} from "@/components/markets/filters";

const metro = () => "metro" as const;
const coastal = () => "coastal" as const;

/**
 * A row the sliders' literal track bounds would exclude: nightly rate
 * below the $90 track floor, rent below the $600 track floor, occupancy
 * near the 40% floor, and a NEGATIVE cushion (occ 41% vs breakeven 55%).
 * The default view must still show it.
 */
const outsider: Sortable = {
  adr: 82,
  occupancy: 0.41,
  activeListings: 1200,
  avgBreakeven2br: 0.55,
  medianRent2br: 500,
  stateCode: "TN",
};

/** A row that clears the higher thresholds: ~$52.1K/yr revenue, RevPAR ~$143. */
const strong: Sortable = {
  ...outsider,
  adr: 210,
  occupancy: 0.68,
  avgBreakeven2br: 0.44,
  medianRent2br: 1900,
};

const f = (patch: Partial<ExplorerFilters> = {}): ExplorerFilters => ({
  ...DEFAULT_FILTERS,
  ...patch,
});

describe("matchesFilters — open extremes (the default view hides nothing)", () => {
  it("matches a row outside every slider track under DEFAULT_FILTERS", () => {
    expect(matchesFilters(outsider, "chattanooga tennessee tn", f(), metro)).toBe(
      true
    );
  });

  it("matches occupancy below the 40% track floor at defaults", () => {
    expect(matchesFilters({ ...outsider, occupancy: 0.35 }, "", f(), metro)).toBe(
      true
    );
  });

  it("matches rent above the $3,200 track ceiling at defaults", () => {
    expect(
      matchesFilters({ ...outsider, medianRent2br: 3400 }, "", f(), metro)
    ).toBe(true);
  });

  it("keeps negative-cushion rows visible at the default 'Any cushion'", () => {
    expect(outsider.occupancy - outsider.avgBreakeven2br).toBeLessThan(0);
    expect(matchesFilters(outsider, "", f(), metro)).toBe(true);
  });

  it("starts filtering once a bound moves off its extreme", () => {
    expect(matchesFilters(outsider, "", f({ adrMin: 100 }), metro)).toBe(false);
    expect(matchesFilters(outsider, "", f({ occMin: 0.45 }), metro)).toBe(false);
    expect(matchesFilters(outsider, "", f({ marginMin: 10 }), metro)).toBe(false);
    expect(matchesFilters(outsider, "", f({ listingsMax: 1000 }), metro)).toBe(
      false
    );
  });
});

describe("matchesFilters — query and states", () => {
  it("query substring-matches the haystack, case-insensitively", () => {
    const hay = "chattanooga tennessee tn";
    expect(matchesFilters(outsider, hay, f({ query: "Chatt" }), metro)).toBe(true);
    expect(matchesFilters(outsider, hay, f({ query: "miami" }), metro)).toBe(false);
  });

  it("states list keeps matching rows only", () => {
    expect(matchesFilters(outsider, "", f({ states: ["TN"] }), metro)).toBe(true);
    expect(matchesFilters(outsider, "", f({ states: ["FL"] }), metro)).toBe(false);
  });
});

describe("matchesFilters — market type (terrain)", () => {
  it("empty terrains matches every terrain", () => {
    expect(matchesFilters(outsider, "", f(), metro)).toBe(true);
    expect(matchesFilters(outsider, "", f(), coastal)).toBe(true);
  });

  it('["metro"] keeps metro rows and drops coastal ones', () => {
    const filters = f({ terrains: ["metro"] });
    expect(matchesFilters(outsider, "", filters, metro)).toBe(true);
    expect(matchesFilters(outsider, "", filters, coastal)).toBe(false);
  });

  it("a multi-terrain pick is a union", () => {
    const filters = f({ terrains: ["coastal", "desert"] });
    expect(matchesFilters(outsider, "", filters, coastal)).toBe(true);
    expect(matchesFilters(outsider, "", filters, metro)).toBe(false);
  });
});

describe("matchesFilters — revenue potential minimum", () => {
  it("0 (default) is open — a ~$12.3K/yr row passes", () => {
    expect(matchesFilters(outsider, "", f(), metro)).toBe(true);
  });

  it("$40K+ keeps a ~$52.1K row and drops a ~$12.3K row", () => {
    const filters = f({ revenueMin: 40_000 });
    expect(matchesFilters(strong, "", filters, metro)).toBe(true);
    expect(matchesFilters(outsider, "", filters, metro)).toBe(false);
  });
});

describe("matchesFilters — RevPAR minimum", () => {
  it("0 (default) is open — RevPAR ~$33.60 passes", () => {
    expect(matchesFilters(outsider, "", f(), metro)).toBe(true);
  });

  it("$100+ keeps RevPAR ~$143 and drops ~$33.60", () => {
    const filters = f({ revparMin: 100 });
    expect(matchesFilters(strong, "", filters, metro)).toBe(true);
    expect(matchesFilters(outsider, "", filters, metro)).toBe(false);
  });
});

describe("matchesFilters — median 2 bd rent range", () => {
  it("defaults are open on both ends", () => {
    expect(matchesFilters(outsider, "", f(), metro)).toBe(true); // $500, below track
    expect(
      matchesFilters({ ...outsider, medianRent2br: 3400 }, "", f(), metro)
    ).toBe(true); // above track
  });

  it("a raised rentMin excludes cheaper leases", () => {
    const filters = f({ rentMin: 800 });
    expect(matchesFilters(outsider, "", filters, metro)).toBe(false);
    expect(matchesFilters(strong, "", filters, metro)).toBe(true);
  });

  it("a lowered rentMax excludes pricier leases", () => {
    const filters = f({ rentMax: 1500 });
    expect(matchesFilters(strong, "", filters, metro)).toBe(false);
    expect(matchesFilters(outsider, "", filters, metro)).toBe(true);
  });
});

describe("matchesFilters — breakeven cap", () => {
  it("the default cap of 1 (100%) matches a 55% breakeven", () => {
    expect(matchesFilters(outsider, "", f({ breakevenMax: 1 }), metro)).toBe(true);
  });

  it("a 40% cap rejects a 55% breakeven", () => {
    expect(matchesFilters(outsider, "", f({ breakevenMax: 0.4 }), metro)).toBe(
      false
    );
  });

  it("a 60% cap keeps a 55% breakeven", () => {
    expect(matchesFilters(outsider, "", f({ breakevenMax: 0.6 }), metro)).toBe(
      true
    );
  });
});

describe("isDefaultFilters", () => {
  it("is true for a spread copy of DEFAULT_FILTERS", () => {
    expect(isDefaultFilters({ ...DEFAULT_FILTERS })).toBe(true);
  });

  it("is false when any new field moves off its default", () => {
    expect(isDefaultFilters(f({ terrains: ["desert"] }))).toBe(false);
    expect(isDefaultFilters(f({ revenueMin: 25_000 }))).toBe(false);
    expect(isDefaultFilters(f({ revparMin: 50 }))).toBe(false);
    expect(isDefaultFilters(f({ rentMin: 800 }))).toBe(false);
    expect(isDefaultFilters(f({ rentMax: 3000 }))).toBe(false);
    expect(isDefaultFilters(f({ breakevenMax: 0.6 }))).toBe(false);
  });

  it("still tracks the original fields", () => {
    expect(isDefaultFilters(f({ query: "austin" }))).toBe(false);
    expect(isDefaultFilters(f({ marginMin: 10 }))).toBe(false);
  });
});
