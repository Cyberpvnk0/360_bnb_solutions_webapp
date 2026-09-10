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
import { analyzeHref, analyzeSearchHref } from "./analyze-href";
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

  it("carries the listing's own page, so the result opens it rather than searching", () => {
    // The analyzer cannot find the page for itself — no portal resolves
    // an address to a listing — so a card with a direct link opened a
    // result that could only search for the property.
    const own = "https://www.redfin.com/FL/Neptune-Beach/1535-Van-Buren-St/home/1";
    expect(paramsOf(analyzeHref({ ...SPEC, sourceUrl: own })).get("u")).toBe(own);
  });

  it("carries no page it would not link to", () => {
    // The same rule "View photos" applies: https, on the listing site.
    for (const sourceUrl of [
      undefined,
      "http://www.redfin.com/x",
      "https://evil.example/redfin.com",
      "javascript:alert(1)",
    ]) {
      expect(paramsOf(analyzeHref({ ...SPEC, sourceUrl })).has("u")).toBe(false);
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

  it("keeps the listing's page on the analysis it builds", () => {
    // This is what the result's "View photos" reads. Absent for a typed
    // address, which genuinely has no page behind it.
    const own = "https://www.redfin.com/FL/x/home/1";
    expect(buildAddressAnalysis({ ...SPEC, sourceUrl: own }).analysis.sourceUrl).toBe(own);
    expect(buildAddressAnalysis(SPEC).analysis.sourceUrl).toBeUndefined();
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

  it("still knows who to call", () => {
    const contact = { company: "Riverside Realty", phone: "(904) 555-0142", role: "Listing broker" as const };
    const analysis = analysisForListing({
      ...listing,
      id: "live--x--2",
      analysisId: "r--live--x--2",
      contact,
    });
    expect(analysis.contact).toEqual(contact);
    // And invents nobody for a row that had none.
    expect(analysisForListing(listing).contact).toBeUndefined();
  });
});

describe("the link out of an address search", () => {
  const POINT = { lat: 30.33, lon: -81.66 };

  it("sends the street with the city and state beside it", () => {
    const p = paramsOf(
      analyzeSearchHref({
        address: "1535 Van Buren St, Jacksonville, FL 32206",
        street: "1535 Van Buren St",
        city: "Jacksonville",
        state: "FL",
        point: POINT,
      })
    );
    expect(p.get("a")).toBe("1535 Van Buren St");
    expect(p.get("c")).toBe("Jacksonville");
    expect(p.get("s")).toBe("FL");
    expect(Number(p.get("lat"))).toBeCloseTo(30.33, 6);
    expect(Number(p.get("lon"))).toBeCloseTo(-81.66, 6);
  });

  it("sends the whole line alone when there is no street line to send", () => {
    // A typed line placed as is: nothing to split, so nothing repeats.
    const p = paramsOf(
      analyzeSearchHref({ address: "1535 Van Buren St, Jacksonville, FL", point: POINT })
    );
    expect(p.get("a")).toBe("1535 Van Buren St, Jacksonville, FL");
    expect(p.has("c")).toBe(false);
    expect(p.has("s")).toBe(false);
  });

  it("states no size, type or rent — nobody did", () => {
    // The result then says it assumed the size rather than presenting
    // a guess as a reading.
    const p = paramsOf(analyzeSearchHref({ address: "1 Main St", point: POINT }));
    for (const k of ["bd", "ba", "t", "r"]) expect(p.has(k)).toBe(false);
  });
});
