import { describe, expect, it } from "vitest";
import { COMPS_PATH, extractArray, mapComp, MARKET_PATH, mapMarketAnalytics, toFraction } from "./airroi";

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


/**
 * A comp exactly as the service sends one — the eight nested groups,
 * with only the fields the mapper reads filled in. Written from an
 * observed response, not from a guess at one.
 */
function realComp(over: Record<string, unknown> = {}) {
  return {
    listing_info: { listing_id: 41234567, listing_name: "Riverside 2BR", description: "PROSE THAT MUST NOT ESCAPE" },
    location_info: { latitude: 30.3255, longitude: -81.6612, exact_location: true },
    property_details: { guests: 4, bedrooms: 2, beds: 3, baths: 2 },
    performance_metrics: {
      ttm_avg_rate: 214.6,
      ttm_occupancy: 0.63,
      ttm_adjusted_occupancy: 0.81,
      ttm_revenue: 49_340,
    },
    ...over,
  };
}

describe("the real nested payload", () => {
  it("reads rate, occupancy and size out of their groups", () => {
    const c = mapComp(realComp(), 0);
    expect(c?.adr).toBe(215);
    expect(c?.occupancy).toBeCloseTo(0.63);
    expect(c?.bedrooms).toBe(2);
    expect(c?.bathrooms).toBe(2);
  });

  it("takes bedrooms, not beds — a studio with two beds is not a 2BR", () => {
    const c = mapComp(realComp({ property_details: { bedrooms: 0, beds: 2, baths: 1 } }), 0);
    expect(c?.bedrooms).toBe(0);
  });

  it("uses unadjusted occupancy, the conservative one", () => {
    // Adjusted (0.81) excludes nights the host blocked. Someone holding
    // a lease has all 365 to fill, so the lower figure is the honest one.
    expect(mapComp(realComp(), 0)?.occupancy).toBeCloseTo(0.63);
  });

  it("keeps the measured annual revenue rather than recomputing it", () => {
    expect(mapComp(realComp(), 0)?.annualRevenue).toBe(49_340);
  });

  it("carries no prose anywhere in the result", () => {
    const c = mapComp(realComp(), 0);
    expect(JSON.stringify(c)).not.toContain("PROSE");
  });

  it("pins an exact location", () => {
    const c = mapComp(realComp(), 0);
    expect(c?.lat).toBeCloseTo(30.3255);
    expect(c?.lon).toBeCloseTo(-81.6612);
  });

  it("treats a fuzzed location as no location", () => {
    // Airbnb blurs a listing's position until it is booked, and the
    // payload says which. Drawing a blurred point as a precise pin is
    // the lie this avoids.
    const c = mapComp(
      realComp({ location_info: { latitude: 30.3, longitude: -81.6, exact_location: false } }),
      0
    );
    expect(c?.lat).toBeUndefined();
    expect(c?.lon).toBeUndefined();
  });

  it("still reads a flat payload, so a reshape degrades instead of vanishing", () => {
    const c = mapComp({ id: "x", adr: 180, occupancy: 0.55, bedrooms: 1 }, 0);
    expect(c?.adr).toBe(180);
  });

  it("finds the row array under their `listings` key", () => {
    expect(extractArray({ listings: [realComp(), realComp()] })).toHaveLength(2);
  });
});
