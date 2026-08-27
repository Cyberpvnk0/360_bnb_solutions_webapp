import { describe, expect, it } from "vitest";
import { COMPS_PATH, mapComp, MARKET_PATH, mapMarketAnalytics, toFraction } from "./airroi";

describe("endpoint paths", () => {
  // An earlier draft invented a /v1/ prefix that does not exist, so the
  // first live call would have 404'd before any mapping ran.
  it("carries no version prefix", () => {
    expect(COMPS_PATH).toBe("/listings/comparables");
    expect(MARKET_PATH).toBe("/markets/lookup");
    expect(COMPS_PATH.startsWith("/v1")).toBe(false);
    expect(MARKET_PATH.startsWith("/v1")).toBe(false);
  });
});

describe("occupancy normalisation", () => {
  it("accepts either scale and stores fractions", () => {
    expect(toFraction(62)).toBeCloseTo(0.62);
    expect(toFraction(0.62)).toBeCloseTo(0.62);
    expect(toFraction(140)).toBeNull();
  });
});

describe("comp coordinates", () => {
  it("keeps a real position when the feed gives one", () => {
    const c = mapComp(
      { id: "1", adr: 210, occupancy: 0.64, bedrooms: 2, latitude: 30.33, longitude: -81.66 },
      0
    );
    expect(c?.lat).toBeCloseTo(30.33);
    expect(c?.lon).toBeCloseTo(-81.66);
  });

  it("accepts lng as well as longitude", () => {
    const c = mapComp({ id: "2", adr: 180, occupancy: 55, lat: 27.95, lng: -82.46 }, 0);
    expect(c?.lat).toBeCloseTo(27.95);
    expect(c?.lon).toBeCloseTo(-82.46);
  });

  it("refuses half a coordinate rather than pinning the meridian", () => {
    const c = mapComp({ id: "3", adr: 180, occupancy: 0.5, latitude: 27.95 }, 0);
    expect(c?.lat).toBeUndefined();
    expect(c?.lon).toBeUndefined();
  });

  it("refuses an out-of-range pair", () => {
    const c = mapComp({ id: "4", adr: 180, occupancy: 0.5, latitude: 991, longitude: -82 }, 0);
    expect(c?.lat).toBeUndefined();
  });

  it("drops a comp with no rate — a fabricated one poisons the projection", () => {
    expect(mapComp({ id: "5", occupancy: 0.6 }, 0)).toBeNull();
  });
});

describe("market analytics", () => {
  it("reads the vendor's documented field names", () => {
    const m = mapMarketAnalytics({
      avg_daily_rate: 212.4,
      avg_occupancy: 61,
      active_listings: 3910,
    });
    expect(m?.adr).toBe(212);
    expect(m?.occupancy).toBeCloseTo(0.61);
    expect(m?.activeListings).toBe(3910);
  });
});
