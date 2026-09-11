import { describe, expect, it } from "vitest";
import { MIN_COMPS } from "./areas";
import {
  MAX_BEDROOMS,
  MIN_RENTALS,
  bestSize,
  buildSizes,
  sizeLabel,
  type SizeRow,
} from "./sizes";
import type { PoolComp } from "@/lib/live/comp-pool";
import type { RentalListing } from "@/lib/mock/types";

function comps(bd: number, count: number, adr: number, occ: number): PoolComp[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `c${bd}-${i}`,
    lat: 30,
    lon: -81,
    bd,
    adr,
    occ,
    at: "2026-01-01T00:00:00.000Z",
  }));
}

function rentals(bd: number, count: number, rent: number): RentalListing[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${bd}-${i}`,
    analysisId: `a${bd}-${i}`,
    address: "1 Main St",
    city: "Jacksonville",
    stateCode: "FL",
    marketSlug: "jacksonville",
    lat: 30,
    lon: -81,
    bedrooms: bd,
    bathrooms: 2,
    sqft: 900,
    propertyType: "house",
    rentMonthly: rent,
    petFriendly: false,
  })) as RentalListing[];
}

describe("sizeLabel", () => {
  it("names a studio, a count and the top bucket", () => {
    expect(sizeLabel(0)).toBe("Studio");
    expect(sizeLabel(2)).toBe("2 bd");
    expect(sizeLabel(MAX_BEDROOMS)).toBe(`${MAX_BEDROOMS}+ bd`);
  });
});

describe("buildSizes", () => {
  it("is empty with nothing to read", () => {
    expect(buildSizes({ comps: [], listings: [] })).toEqual([]);
  });

  it("medians each side and nets a spread", () => {
    const [row] = buildSizes({
      comps: comps(2, MIN_COMPS, 200, 0.6),
      listings: rentals(2, MIN_RENTALS, 1500),
    });
    expect(row.bedrooms).toBe(2);
    expect(row.adr).toBe(200);
    expect(row.occupancy).toBe(0.6);
    expect(row.revenue).toBe(Math.round(200 * 0.6 * 365));
    expect(row.rent).toBe(1500);
    expect(row.spread).toBe(Math.round(200 * 0.6 * 365 - 1500 * 12));
  });

  it("holds the rates back under the listing floor", () => {
    const [row] = buildSizes({
      comps: comps(2, MIN_COMPS - 1, 200, 0.6),
      listings: rentals(2, MIN_RENTALS, 1500),
    });
    expect(row.comps).toBe(MIN_COMPS - 1);
    expect(row.adr).toBeNull();
    expect(row.revenue).toBeNull();
    expect(row.spread).toBeNull();
    // The lease side still stands on its own.
    expect(row.rent).toBe(1500);
  });

  it("holds the rent back under the rental floor", () => {
    const [row] = buildSizes({
      comps: comps(2, MIN_COMPS, 200, 0.6),
      listings: rentals(2, MIN_RENTALS - 1, 1500),
    });
    expect(row.rentals).toBe(MIN_RENTALS - 1);
    expect(row.rent).toBeNull();
    expect(row.spread).toBeNull();
    expect(row.revenue).not.toBeNull();
  });

  it("keeps a size that has only one side", () => {
    const rows = buildSizes({
      comps: comps(1, MIN_COMPS, 150, 0.55),
      listings: rentals(3, MIN_RENTALS, 2200),
    });
    expect(rows.map((r) => r.bedrooms)).toEqual([1, 3]);
    expect(rows[0].rentals).toBe(0);
    expect(rows[1].comps).toBe(0);
  });

  it("folds everything past the top bucket into one row", () => {
    const rows = buildSizes({
      comps: [...comps(5, MIN_COMPS, 400, 0.5), ...comps(7, MIN_COMPS, 400, 0.5)],
      listings: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].bedrooms).toBe(MAX_BEDROOMS);
    expect(rows[0].comps).toBe(MIN_COMPS * 2);
  });

  it("rounds a half-bedroom to its nearest size and studios to zero", () => {
    const rows = buildSizes({
      comps: [],
      listings: [...rentals(0, MIN_RENTALS, 900), ...rentals(1, MIN_RENTALS, 1200)],
    });
    expect(rows.map((r) => r.label)).toEqual(["Studio", "1 bd"]);
  });

  it("comes back in size order", () => {
    const rows = buildSizes({
      comps: [...comps(3, MIN_COMPS, 300, 0.5), ...comps(1, MIN_COMPS, 150, 0.5)],
      listings: rentals(2, MIN_RENTALS, 1500),
    });
    expect(rows.map((r) => r.bedrooms)).toEqual([1, 2, 3]);
  });
});

describe("bestSize", () => {
  const row = (over: Partial<SizeRow> & { bedrooms: number }): SizeRow => ({
    label: sizeLabel(over.bedrooms),
    comps: 10,
    adr: 200,
    occupancy: 0.6,
    revenue: 40_000,
    rentals: 5,
    rent: 1500,
    spread: 20_000,
    ...over,
  });

  it("is the widest spread", () => {
    const best = bestSize([
      row({ bedrooms: 1, spread: 10_000 }),
      row({ bedrooms: 3, spread: 31_000 }),
      row({ bedrooms: 2, spread: 22_000 }),
    ]);
    expect(best?.bedrooms).toBe(3);
  });

  it("ignores sizes with no spread", () => {
    const best = bestSize([
      row({ bedrooms: 1, spread: null }),
      row({ bedrooms: 2, spread: 5_000 }),
    ]);
    expect(best?.bedrooms).toBe(2);
  });

  it("is null when no size has both halves", () => {
    expect(bestSize([row({ bedrooms: 2, spread: null })])).toBeNull();
  });

  it("picks the least bad when every spread is negative", () => {
    const best = bestSize([
      row({ bedrooms: 1, spread: -9_000 }),
      row({ bedrooms: 2, spread: -2_000 }),
    ]);
    expect(best?.bedrooms).toBe(2);
  });
});
