import { describe, expect, it } from "vitest";
import { breakevenOccupancy, projectDeal } from "./arbitrage";
import { deriveMarketAssumptions } from "./comps";
import { basisLabel, defaultsForListing, estimateDeal } from "./deal-read";
import { buildAddressAnalysis } from "@/lib/live/address-analysis";
import { adrFactorFor, MARKET_BY_SLUG } from "@/lib/mock/markets";
import { estimateCushionPts, rentalsFor } from "@/lib/mock/rentals";

const market = MARKET_BY_SLUG.get("jacksonville")!;
const listing = rentalsFor(market)[0];

describe("a card's read stands where the analyzer stands", () => {
  it("starts from the analyzer's own default inputs for the listing", () => {
    // The same id, the same seed, the same asking rent: what the
    // analyzer page builds when this listing is handed to it.
    const { analysis } = buildAddressAnalysis(
      {
        address: listing.address,
        lat: listing.lat,
        lon: listing.lon,
        bedrooms: listing.bedrooms,
        bathrooms: listing.bathrooms,
        propertyType: listing.propertyTypeKnown === false ? "house" : listing.propertyType,
        rentMonthly: listing.rentMonthly,
      },
      market.slug
    );
    expect(defaultsForListing(listing, market)).toEqual(analysis.defaults);
  });

  it("projects the net the analyzer projects, given the analyzer's figures", () => {
    // Handed a comp set's ADR and occupancy, the card's net profit is
    // the page's net cash flow to the dollar — one calculator, one set
    // of inputs, one set of figures.
    const comps = [
      { adr: 150, occupancy: 0.3 },
      { adr: 170, occupancy: 0.32 },
      { adr: 190, occupancy: 0.28 },
      { adr: 160, occupancy: 0.35 },
      { adr: 180, occupancy: 0.3 },
    ];
    const assumptions = deriveMarketAssumptions(comps);
    const page = projectDeal(defaultsForListing(listing, market), assumptions);
    const card = estimateDeal(listing, market, {
      adr: assumptions.adr,
      occupancy: assumptions.marketOccupancy,
      kind: "comps",
      area: null,
      at: null,
      comps: 5,
      radiusMiles: 2,
    });
    expect(card.netCashFlow).toBe(Math.round(page.netCashFlow));
    expect(card.cushionPts).toBe(Math.round(page.marginOfSafety * 100));
    expect(card.nightlyRate).toBe(assumptions.adr);
    expect(basisLabel(card.basis)).toBe("Analyzed (5 listings within 2 mi) · 31% occupancy");
  });
});

describe("what a read stands on", () => {
  it("takes the listings around the property as this size's rate, unscaled", () => {
    const read = estimateDeal(listing, market, {
      adr: 171,
      occupancy: 0.31,
      kind: "nearby",
      area: null,
      at: null,
      comps: 9,
      radiusMiles: 1,
    });
    expect(read.nightlyRate).toBe(171);
    expect(read.basis).toMatchObject({ kind: "nearby", comps: 9, radiusMiles: 1 });
    expect(basisLabel(read.basis)).toBe("Nearby listings (9 within 1 mi) · 31% occupancy");
  });

  it("scales an area's average across sizes to this size, and says so", () => {
    const read = estimateDeal(listing, market, {
      adr: 200,
      occupancy: 0.5,
      kind: "city",
      area: "Jacksonville",
      at: "2026-09-01T00:00:00Z",
    });
    expect(read.nightlyRate).toBe(Math.round(200 * adrFactorFor(listing.bedrooms)));
    expect(basisLabel(read.basis)).toBe("Measured for Jacksonville · 50% occupancy");
  });

  it("falls to the modelled catalogue figures and says so, or holds while measuring", () => {
    const modelled = estimateDeal(listing, market);
    expect(modelled.basis.kind).toBe("modelled");
    expect(basisLabel(modelled.basis)).toMatch(/^Modelled/);
    expect(estimateDeal(listing, market, null, { pending: true }).basis.kind).toBe("pending");
    // The old benchmark read and this one agree on the rate they scale
    // from; they differ on costs, which is the point.
    expect(modelled.nightlyRate).toBe(Math.round(market.adr * adrFactorFor(listing.bedrooms)));
    const be = breakevenOccupancy(defaultsForListing(listing, market), {
      adr: modelled.nightlyRate,
      marketOccupancy: market.occupancy,
    });
    expect(modelled.cushionPts).toBe(Math.round((market.occupancy - be) * 100));
    expect(typeof estimateCushionPts(listing, market)).toBe("number");
  });
});
