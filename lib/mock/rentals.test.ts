import { describe, expect, it } from "vitest";
import { estimateRentFromComps } from "@/lib/calc/comps";
import { analysisForListing } from "./analyses";
import { MARKET_BY_SLUG, MARKETS } from "./markets";
import {
  allRentals,
  BEDROOM_ADR_FACTOR,
  BEDROOM_RENT_FACTOR,
  estimateCushionPts,
  RENTAL_BY_ANALYSIS_ID,
  rentalCountFor,
  rentalsFor,
  totalRentalCount,
} from "./rentals";

describe("rentals", () => {
  it("every market carries 6–12 listings, matching the analytic count", () => {
    for (const m of MARKETS) {
      const listings = rentalsFor(m);
      expect(listings.length).toBe(rentalCountFor(m.slug));
      expect(listings.length).toBeGreaterThanOrEqual(6);
      expect(listings.length).toBeLessThanOrEqual(12);
    }
  });

  it("the analytic total matches the materialized total", () => {
    expect(totalRentalCount()).toBe(allRentals().length);
  });

  it("is deterministic across calls (memoized, same reference)", () => {
    const m = MARKETS[0];
    expect(rentalsFor(m)).toBe(rentalsFor(m));
    expect(allRentals()).toBe(allRentals());
  });

  it("asking rents stay within ±10% of the bedroom-scaled 2 bd median", () => {
    for (const listing of allRentals()) {
      const market = MARKET_BY_SLUG.get(listing.marketSlug)!;
      const base = market.medianRent2br * BEDROOM_RENT_FACTOR[listing.bedrooms];
      // $25 rounding can nudge a boundary draw just past the raw band.
      expect(listing.rentMonthly).toBeGreaterThanOrEqual(base * 0.9 - 13);
      expect(listing.rentMonthly).toBeLessThanOrEqual(base * 1.1 + 13);
      expect(listing.rentMonthly % 25).toBe(0);
    }
  });

  it("ids and analysis ids are globally unique", () => {
    const all = allRentals();
    expect(new Set(all.map((l) => l.id)).size).toBe(all.length);
    expect(new Set(all.map((l) => l.analysisId)).size).toBe(all.length);
  });

  it("listings sit near their parent market with the specified shapes", () => {
    for (const listing of allRentals()) {
      const market = MARKET_BY_SLUG.get(listing.marketSlug)!;
      expect(Math.abs(listing.lat - market.lat)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(listing.lon - market.lon)).toBeLessThanOrEqual(0.05);
      expect(listing.city).toBe(market.name);
      expect(listing.stateCode).toBe(market.stateCode);
      expect(Number.isInteger(listing.bedrooms)).toBe(true);
      expect(listing.bedrooms).toBeGreaterThanOrEqual(1);
      expect(listing.bedrooms).toBeLessThanOrEqual(5);
      expect(listing.bathrooms * 2).toBeCloseTo(
        Math.round(listing.bathrooms * 2),
        8
      );
      expect(listing.sqft % 10).toBe(0);
      expect(Number.isInteger(listing.daysOnMarket)).toBe(true);
      expect(listing.daysOnMarket).toBeGreaterThanOrEqual(0);
      expect(listing.daysOnMarket).toBeLessThanOrEqual(45);
    }
  });

  it("cushion is whole points and pure", () => {
    const listing = allRentals()[0];
    const market = MARKET_BY_SLUG.get(listing.marketSlug)!;
    const pts = estimateCushionPts(listing, market);
    expect(Number.isInteger(pts)).toBe(true);
    expect(estimateCushionPts(listing, market)).toBe(pts);
    // Sanity: every bedroom count has both factors defined.
    for (const br of [1, 2, 3, 4, 5]) {
      expect(BEDROOM_ADR_FACTOR[br]).toBeGreaterThan(0);
      expect(BEDROOM_RENT_FACTOR[br]).toBeGreaterThan(0);
    }
  });

  it("indexes every listing by analysis id once materialized", () => {
    const all = allRentals();
    expect(RENTAL_BY_ANALYSIS_ID.size).toBe(all.length);
    expect(RENTAL_BY_ANALYSIS_ID.get(all[10].analysisId)).toBe(all[10]);
  });

  it("analysisForListing mirrors the listing and keeps comp-backed defaults", () => {
    for (const listing of allRentals().slice(0, 60)) {
      const a = analysisForListing(listing);
      expect(a.id).toBe(listing.analysisId);
      expect(a.address).toBe(listing.address);
      expect(a.city).toBe(listing.city);
      expect(a.stateCode).toBe(listing.stateCode);
      expect(a.marketSlug).toBe(listing.marketSlug);
      expect(a.bedrooms).toBe(listing.bedrooms);
      expect(a.bathrooms).toBe(listing.bathrooms);
      expect(a.propertyType).toBe(listing.propertyType);
      // The same consistency rule every seeded pull obeys: the default
      // rent IS the median of the LTR comp list shown beside it.
      expect(a.defaults.monthlyRent).toBe(estimateRentFromComps(a.ltrComps));
    }
  });

  it("analysisForListing is memoized (same reference twice)", () => {
    const listing = allRentals()[3];
    expect(analysisForListing(listing)).toBe(analysisForListing(listing));
  });
});
