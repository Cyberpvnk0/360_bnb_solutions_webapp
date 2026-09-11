import { describe, expect, it } from "vitest";
import {
  ASSIGN_RADIUS_MILES,
  MIN_COMPS,
  buildAreas,
  median,
  milesApart,
  sortAreas,
  versusMarket,
  type AreaRow,
} from "./areas";
import type { PoolComp } from "@/lib/live/comp-pool";
import type { RentalListing } from "@/lib/mock/types";

const MARKET = { name: "Jacksonville" };

function rental(over: Partial<RentalListing> & { id: string }): RentalListing {
  return {
    analysisId: `a-${over.id}`,
    address: "1 Main St, Jacksonville, FL 32207",
    city: "Jacksonville",
    stateCode: "FL",
    marketSlug: "jacksonville",
    lat: 30.3,
    lon: -81.65,
    bedrooms: 2,
    bathrooms: 2,
    sqft: 1000,
    propertyType: "house",
    rentMonthly: 1500,
    petFriendly: false,
    ...over,
  } as RentalListing;
}

function comp(lat: number, lon: number, adr: number, occ: number, i: number): PoolComp {
  return { id: `c${i}`, lat, lon, bd: 2, adr, occ, at: "2026-01-01T00:00:00.000Z" };
}

/** MIN_COMPS listings at one point, so a bucket clears the floor. */
function enoughAt(lat: number, lon: number, adr: number, occ: number): PoolComp[] {
  return Array.from({ length: MIN_COMPS }, (_, i) => comp(lat, lon, adr, occ, i));
}

describe("median", () => {
  it("is null for nothing", () => {
    expect(median([])).toBeNull();
  });

  it("takes the middle of an odd count", () => {
    expect(median([9, 1, 5])).toBe(5);
  });

  it("averages the middle two of an even count", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("milesApart", () => {
  it("is zero at the same point", () => {
    expect(milesApart({ lat: 30, lon: -81 }, { lat: 30, lon: -81 })).toBe(0);
  });

  it("puts a degree of latitude near sixty-nine miles", () => {
    const d = milesApart({ lat: 30, lon: -81 }, { lat: 31, lon: -81 });
    expect(d).toBeGreaterThan(68);
    expect(d).toBeLessThan(70);
  });
});

describe("buildAreas", () => {
  it("has no areas without rentals to name them", () => {
    const rows = buildAreas({
      market: MARKET,
      listings: [],
      comps: enoughAt(30.3, -81.65, 200, 0.6),
    });
    expect(rows).toEqual([]);
  });

  it("groups rentals by ZIP and medians their rent", () => {
    const rows = buildAreas({
      market: MARKET,
      listings: [
        rental({ id: "1", zip: "32207", rentMonthly: 1400 }),
        rental({ id: "2", zip: "32207", rentMonthly: 1800 }),
        rental({ id: "3", zip: "32204", rentMonthly: 1200 }),
      ],
      comps: [],
    });
    const by = new Map(rows.map((r) => [r.zip, r]));
    expect(by.get("32207")?.rentals).toBe(2);
    expect(by.get("32207")?.medianRent).toBe(1600);
    expect(by.get("32204")?.medianRent).toBe(1200);
  });

  it("reads the ZIP off the address when the row has no field", () => {
    const rows = buildAreas({
      market: MARKET,
      listings: [rental({ id: "1", address: "9 Oak Ave, Jacksonville, FL 32250" })],
      comps: [],
    });
    expect(rows.map((r) => r.zip)).toEqual(["32250"]);
  });

  it("names the town only when it differs from the market", () => {
    const rows = buildAreas({
      market: MARKET,
      listings: [
        rental({ id: "1", zip: "32207", city: "Jacksonville" }),
        rental({ id: "2", zip: "32250", city: "Jacksonville Beach" }),
      ],
      comps: [],
    });
    const by = new Map(rows.map((r) => [r.zip, r]));
    expect(by.get("32207")?.town).toBeNull();
    expect(by.get("32250")?.town).toBe("Jacksonville Beach");
  });

  it("holds the rates back until there are enough listings", () => {
    const short = buildAreas({
      market: MARKET,
      listings: [rental({ id: "1", zip: "32207" })],
      comps: [comp(30.3, -81.65, 200, 0.6, 1)],
    })[0];
    expect(short.comps).toBe(1);
    expect(short.adr).toBeNull();
    expect(short.occupancy).toBeNull();
    expect(short.revenue).toBeNull();

    const full = buildAreas({
      market: MARKET,
      listings: [rental({ id: "1", zip: "32207" })],
      comps: enoughAt(30.3, -81.65, 200, 0.6),
    })[0];
    expect(full.comps).toBe(MIN_COMPS);
    expect(full.adr).toBe(200);
    expect(full.occupancy).toBe(0.6);
    expect(full.revenue).toBe(Math.round(200 * 0.6 * 365));
  });

  it("ignores a listing further out than the assignment radius", () => {
    // Roughly ten miles north, well past the radius.
    const far = 30.3 + ASSIGN_RADIUS_MILES / 69 + 0.1;
    const rows = buildAreas({
      market: MARKET,
      listings: [rental({ id: "1", zip: "32207" })],
      comps: enoughAt(far, -81.65, 200, 0.6),
    });
    expect(rows[0].comps).toBe(0);
    expect(rows[0].adr).toBeNull();
  });

  it("places a listing in the nearer of two ZIPs", () => {
    const rows = buildAreas({
      market: MARKET,
      listings: [
        rental({ id: "1", zip: "32207", lat: 30.3, lon: -81.65 }),
        rental({ id: "2", zip: "32204", lat: 30.32, lon: -81.7 }),
      ],
      comps: enoughAt(30.319, -81.699, 210, 0.55),
    });
    const by = new Map(rows.map((r) => [r.zip, r]));
    expect(by.get("32204")?.comps).toBe(MIN_COMPS);
    expect(by.get("32207")?.comps).toBe(0);
  });

  it("carries a spread only with both halves", () => {
    const [withBoth] = buildAreas({
      market: MARKET,
      listings: [rental({ id: "1", zip: "32207", bedrooms: 2, rentMonthly: 1500 })],
      comps: enoughAt(30.3, -81.65, 200, 0.6),
    });
    expect(withBoth.spread).toBe(Math.round(200 * 0.6 * 365 - 1500 * 12));

    // Only a three-bed lease here, so there is no two-bed to net against.
    const [noRent] = buildAreas({
      market: MARKET,
      listings: [rental({ id: "1", zip: "32207", bedrooms: 3, rentMonthly: 1500 })],
      comps: enoughAt(30.3, -81.65, 200, 0.6),
    });
    expect(noRent.rent2br).toBeNull();
    expect(noRent.spread).toBeNull();
  });

  it("attaches a bought ZIP to its row", () => {
    const [row] = buildAreas({
      market: MARKET,
      listings: [rental({ id: "1", zip: "32207" })],
      comps: [],
      measured: new Map([
        [
          "32207",
          {
            adr: 188,
            occupancy: 0.64,
            revenue: 43_900,
            revpar: 120,
            activeListings: 412,
            fullName: "32207, Jacksonville, Florida",
            at: "2026-09-01T00:00:00.000Z",
          },
        ],
      ]),
    });
    expect(row.measured?.activeListings).toBe(412);
  });
});

describe("sortAreas", () => {
  const row = (over: Partial<AreaRow> & { zip: string }): AreaRow => ({
    town: null,
    lat: 30,
    lon: -81,
    rentals: 1,
    medianRent: 1500,
    rent2br: 1500,
    comps: 10,
    adr: 200,
    occupancy: 0.6,
    revenue: 40_000,
    spread: 22_000,
    measured: null,
    ...over,
  });

  it("puts the biggest figure first and the missing one last", () => {
    const rows = [
      row({ zip: "a", revenue: 30_000 }),
      row({ zip: "b", revenue: null }),
      row({ zip: "c", revenue: 50_000 }),
    ];
    expect(sortAreas(rows, "revenue").map((r) => r.zip)).toEqual(["c", "a", "b"]);
  });

  it("sorts rent the other way, still missing last", () => {
    const rows = [
      row({ zip: "a", medianRent: 2000 }),
      row({ zip: "b", medianRent: null }),
      row({ zip: "c", medianRent: 1100 }),
    ];
    expect(sortAreas(rows, "rent").map((r) => r.zip)).toEqual(["c", "a", "b"]);
  });

  it("ranks a bought figure over a seen one", () => {
    const rows = [
      row({ zip: "a", revenue: 90_000 }),
      row({
        zip: "b",
        revenue: 10_000,
        measured: {
          adr: null,
          occupancy: null,
          revenue: 120_000,
          revpar: null,
          activeListings: null,
          fullName: null,
          at: null,
        },
      }),
    ];
    expect(sortAreas(rows, "revenue").map((r) => r.zip)).toEqual(["b", "a"]);
  });

  it("does not mutate what it was given", () => {
    const rows = [row({ zip: "a", revenue: 1 }), row({ zip: "b", revenue: 2 })];
    sortAreas(rows, "revenue");
    expect(rows.map((r) => r.zip)).toEqual(["a", "b"]);
  });

  it("counts a listings rank off the sample when nothing was bought", () => {
    const rows = [
      row({ zip: "a", comps: 4 }),
      row({ zip: "b", comps: 0 }),
      row({ zip: "c", comps: 19 }),
    ];
    expect(sortAreas(rows, "listings").map((r) => r.zip)).toEqual(["c", "a", "b"]);
  });
});

describe("versusMarket", () => {
  it("is the fraction above or below", () => {
    expect(versusMarket(120, 100)).toBeCloseTo(0.2);
    expect(versusMarket(80, 100)).toBeCloseTo(-0.2);
  });

  it("is null without both sides", () => {
    expect(versusMarket(null, 100)).toBeNull();
    expect(versusMarket(120, null)).toBeNull();
    expect(versusMarket(120, 0)).toBeNull();
  });
});
