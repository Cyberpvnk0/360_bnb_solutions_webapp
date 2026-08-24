import { describe, expect, it } from "vitest";
import {
  extractArray,
  mapComp,
  mapMarketAnalytics,
  toFraction,
} from "./airroi";

/**
 * The exact payload keys aren't confirmed yet, so the mapper is built to
 * survive whichever spelling the vendor uses. These pin that tolerance:
 * when the real shape is observed, the winning variant stays green and
 * the rest can be deleted.
 */
describe("airroi mapper", () => {
  it("reads a comp however the payload spells its fields", () => {
    const camel = mapComp(
      {
        id: "abc123",
        title: "Sunny 2BR near the river",
        bedrooms: 2,
        bathrooms: 1.5,
        adr: 184.4,
        occupancy: 0.67,
        distanceMiles: 0.83,
      },
      0
    );
    const snake = mapComp(
      {
        listing_id: "abc123",
        listing_title: "Sunny 2BR near the river",
        beds: 2,
        baths: 1.5,
        average_daily_rate: 184.4,
        occupancy_rate: 67,
        distance: 0.83,
      },
      0
    );
    expect(camel).toEqual({
      id: "sc-live-abc123",
      name: "Sunny 2BR near the river",
      bedrooms: 2,
      bathrooms: 1.5,
      adr: 184,
      occupancy: 0.67,
      distanceMiles: 0.8,
    });
    // Different spelling, percent-scaled occupancy — same comp.
    expect(snake).toEqual(camel);
  });

  it("parses money and percent strings", () => {
    const c = mapComp({ id: "s", adr: "$204", occupancy: "58%" }, 0);
    expect(c?.adr).toBe(204);
    expect(c?.occupancy).toBe(0.58);
  });

  it("normalizes occupancy to a fraction either way", () => {
    expect(toFraction(0.62)).toBe(0.62);
    expect(toFraction(62)).toBe(0.62);
    expect(toFraction(140)).toBeNull();
    expect(toFraction(null)).toBeNull();
  });

  it("drops comps that can't back a projection", () => {
    // No rate, no occupancy, or nonsense — never a fabricated stand-in,
    // because one bad comp moves every number on the page.
    expect(mapComp({ id: "a", occupancy: 0.6 }, 0)).toBeNull();
    expect(mapComp({ id: "a", adr: 200 }, 0)).toBeNull();
    expect(mapComp({ id: "a", adr: 0, occupancy: 0.6 }, 0)).toBeNull();
    expect(mapComp(null, 0)).toBeNull();
    expect(mapComp("nope", 0)).toBeNull();
  });

  it("falls back to a readable name and a synthetic id", () => {
    const c = mapComp({ adr: 150, occupancy: 0.5, bedrooms: 3 }, 4);
    expect(c?.id).toBe("sc-live-airroi-4");
    expect(c?.name).toBe("3 BR nearby rental");
  });

  it("reads market analytics flat or nested", () => {
    const flat = mapMarketAnalytics({
      adr: 139,
      occupancy: 0.6,
      annualRevenue: 30400,
      activeListings: 2400,
    });
    const nested = mapMarketAnalytics({
      data: { average_daily_rate: 139, occupancy_rate: 60, revenue: 30400, active_listings: 2400 },
    });
    expect(flat).toEqual({
      adr: 139,
      occupancy: 0.6,
      annualRevenue: 30400,
      activeListings: 2400,
    });
    expect(nested).toEqual(flat);
    expect(mapMarketAnalytics({ occupancy: 0.6 })).toBeNull();
  });

  it("finds the row array wherever it's nested", () => {
    expect(extractArray([1, 2])).toEqual([1, 2]);
    expect(extractArray({ data: [1] })).toEqual([1]);
    expect(extractArray({ results: [2] })).toEqual([2]);
    expect(extractArray({ listings: [3] })).toEqual([3]);
    expect(extractArray({ nothing: true })).toEqual([]);
  });
});
