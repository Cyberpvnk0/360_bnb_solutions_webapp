/**
 * The handoff from a listing to the calculator.
 *
 * ONE NUMBER CARRIES THE WHOLE PAGE. Cushion, cash flow, breakeven and
 * the verdict badge are all computed off the monthly rent, so a
 * calculator that opens on a modelled median for a property whose real
 * asking rent we hold does not just show one wrong field — it shows a
 * different deal from the card the person clicked to get there. These
 * tests pin the rent to the property at every hop.
 */

import { describe, expect, it } from "vitest";
import { analyzeHref } from "./analyze-href";
import { buildAddressAnalysis } from "./address-analysis";
import { analysisForListing } from "@/lib/mock/analyses";
import { estimateRentFromComps } from "@/lib/calc/comps";
import { MARKETS } from "@/lib/mock/markets";
import type { PropertyType, RentalListing } from "@/lib/mock/types";

const MARKET = MARKETS[0];

const SPEC = {
  address: "1535 Van Buren St",
  lat: MARKET.lat,
  lon: MARKET.lon,
  bedrooms: 2,
  bathrooms: 1,
  propertyType: "apartment" as PropertyType,
};

function paramsOf(href: string): URLSearchParams {
  return new URL(href, "https://example.test").searchParams;
}

describe("the link out of the Deal Finder", () => {
  it("carries the asking rent", () => {
    // Without it the analyzer has nothing to use and falls back to a
    // median of comparable leases, which is a different number.
    const p = paramsOf(analyzeHref({ ...SPEC, rentMonthly: 2150 }));
    expect(p.get("r")).toBe("2150");
  });

  it("carries the unit's own city and state", () => {
    // Not the market's namesake city: a listing in a covered suburb is
    // not in it, and the header would contradict the card.
    const p = paramsOf(
      analyzeHref({ ...SPEC, city: "Neptune Beach", stateCode: "FL" })
    );
    expect(p.get("c")).toBe("Neptune Beach");
    expect(p.get("s")).toBe("FL");
  });

  it("omits the rent rather than sending a nonsense one", () => {
    // Absent is a state the analyzer handles honestly. Zero is not.
    for (const rentMonthly of [undefined, 0, -100, Number.NaN]) {
      expect(paramsOf(analyzeHref({ ...SPEC, rentMonthly })).has("r")).toBe(false);
    }
  });

  it("still carries everything it carried before", () => {
    const p = paramsOf(analyzeHref({ ...SPEC, rentMonthly: 2150 }));
    expect(p.get("a")).toBe("1535 Van Buren St");
    expect(p.get("bd")).toBe("2");
    expect(p.get("ba")).toBe("1");
    expect(p.get("t")).toBe("apartment");
    expect(Number(p.get("lat"))).toBeCloseTo(MARKET.lat, 6);
  });
});

describe("what the calculator opens on", () => {
  it("uses the property's asking rent when it has one", () => {
    const { analysis } = buildAddressAnalysis({ ...SPEC, rentMonthly: 2150 });
    expect(analysis.defaults.monthlyRent).toBe(2150);
  });

  it("falls back to the comp median only when nothing supplied one", () => {
    // A typed address genuinely has no listing behind it, so an
    // estimate is the honest answer there — and only there.
    const { analysis } = buildAddressAnalysis(SPEC);
    expect(analysis.defaults.monthlyRent).toBe(
      estimateRentFromComps(analysis.ltrComps)
    );
  });

  it("does not quietly average the two", () => {
    // Blending a measured figure with a modelled one produces a number
    // that is neither, and nothing on the page could label it.
    const { analysis } = buildAddressAnalysis({ ...SPEC, rentMonthly: 2150 });
    const modelled = estimateRentFromComps(analysis.ltrComps);
    expect(analysis.defaults.monthlyRent).not.toBe(modelled);
    expect(analysis.defaults.monthlyRent).toBe(2150);
  });

  it("ignores an asking rent that is not a rent", () => {
    for (const rentMonthly of [0, -50, Number.NaN]) {
      const { analysis } = buildAddressAnalysis({ ...SPEC, rentMonthly });
      expect(analysis.defaults.monthlyRent).toBe(
        estimateRentFromComps(analysis.ltrComps)
      );
    }
  });

  it("uses the unit's own city when it was supplied", () => {
    const { analysis } = buildAddressAnalysis({
      ...SPEC,
      city: "Neptune Beach",
      stateCode: "FL",
    });
    expect(analysis.city).toBe("Neptune Beach");
    expect(analysis.stateCode).toBe("FL");
  });

  it("falls back to the market's name when it was not", () => {
    const { analysis, market } = buildAddressAnalysis(SPEC);
    expect(analysis.city).toBe(market.name);
    expect(analysis.stateCode).toBe(market.stateCode);
  });
});

describe("a saved listing reopened later", () => {
  const listing: RentalListing = {
    id: "live--x--1",
    analysisId: "r--live--x--1",
    address: "1535 Van Buren St",
    city: MARKET.name,
    stateCode: MARKET.stateCode,
    marketSlug: MARKET.slug,
    lat: MARKET.lat,
    lon: MARKET.lon,
    bedrooms: 2,
    bathrooms: 1,
    sqft: 900,
    propertyType: "apartment",
    rentMonthly: 2150,
    petFriendly: false,
    features: [],
  };

  it("still opens on the rent the listing asked", () => {
    // This path never went through the URL at all, and had the rent in
    // hand the whole time — it just wasn't reading it.
    expect(analysisForListing(listing).defaults.monthlyRent).toBe(2150);
  });
});
