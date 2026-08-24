import { describe, expect, it } from "vitest";
import { estimateRentFromComps } from "@/lib/calc/comps";
import { analysisForListing } from "./analyses";
import { MARKET_BY_SLUG, MARKETS } from "./markets";
import { submarketsFor } from "./submarkets";
import {
  allRentals,
  BASE_FEATURES,
  BEDROOM_ADR_FACTOR,
  BEDROOM_RENT_FACTOR,
  estimateCushionPts,
  RENTAL_BY_ANALYSIS_ID,
  rentalCountFor,
  rentalsFor,
  TERRAIN_FEATURES,
  totalRentalCount,
} from "./rentals";

describe("rentals", () => {
  it("every market's listings span its neighborhoods, matching the count", () => {
    for (const m of MARKETS) {
      const listings = rentalsFor(m);
      expect(listings.length).toBe(rentalCountFor(m));
      // 15–19 submarkets × 1–3 listings each.
      expect(listings.length).toBeGreaterThanOrEqual(15);
      expect(listings.length).toBeLessThanOrEqual(57);
      // Every neighborhood is represented — no downtown-only blobs.
      const subs = submarketsFor(m);
      const named = new Set(listings.map((l) => l.submarketName));
      expect(named.size).toBe(subs.length);
    }
  });

  it("listings spread across the metro, not one tight cluster", () => {
    // Jacksonville's neighborhoods span roughly a quarter degree; a
    // downtown-only blob would collapse this spread toward zero.
    const jax = MARKETS.find((m) => m.slug === "jacksonville")!;
    const listings = rentalsFor(jax);
    const lats = listings.map((l) => l.lat);
    const lons = listings.map((l) => l.lon);
    expect(Math.max(...lats) - Math.min(...lats)).toBeGreaterThan(0.1);
    expect(Math.max(...lons) - Math.min(...lons)).toBeGreaterThan(0.1);
  });

  it("the analytic total matches the materialized total", () => {
    expect(totalRentalCount()).toBe(allRentals().length);
  });

  it("is deterministic across calls (memoized, same reference)", () => {
    const m = MARKETS[0];
    expect(rentalsFor(m)).toBe(rentalsFor(m));
    expect(allRentals()).toBe(allRentals());
  });

  it("asking rents track the neighborhood's own 2 bd median", () => {
    for (const listing of allRentals()) {
      const market = MARKET_BY_SLUG.get(listing.marketSlug)!;
      const sub = submarketsFor(market).find(
        (x) => x.name === listing.submarketName
      )!;
      const base = sub.medianRent2br * BEDROOM_RENT_FACTOR[listing.bedrooms];
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
      // Neighborhood offset (≤0.12) plus in-neighborhood jitter (≤0.012).
      expect(Math.abs(listing.lat - market.lat)).toBeLessThanOrEqual(0.14);
      expect(Math.abs(listing.lon - market.lon)).toBeLessThanOrEqual(0.14);
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

  it("every listing carries 2–6 distinct feature tags", () => {
    for (const l of allRentals()) {
      expect(l.features.length).toBeGreaterThanOrEqual(2);
      expect(l.features.length).toBeLessThanOrEqual(6);
      expect(new Set(l.features).size).toBe(l.features.length);
    }
  });

  it("'Pet friendly' appears in features exactly when petFriendly is set", () => {
    for (const l of allRentals()) {
      expect(l.features.includes("Pet friendly")).toBe(l.petFriendly);
    }
  });

  it("feature tags respect the market's terrain — no waterfront in the desert", () => {
    for (const m of MARKETS) {
      const allowed = new Set<string>([
        "Furnished",
        "Pet friendly",
        ...BASE_FEATURES,
        ...TERRAIN_FEATURES[m.terrain],
      ]);
      for (const l of rentalsFor(m)) {
        for (const f of l.features) {
          expect(allowed.has(f), `${f} on ${l.id} (${m.terrain})`).toBe(true);
        }
      }
    }
  });
});
