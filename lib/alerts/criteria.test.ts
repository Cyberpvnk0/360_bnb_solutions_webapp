import { describe, expect, it } from "vitest";
import { criteriaFromFilters, describeCriteria, matchesCriteria, readCriteria, type FilterLike } from "./criteria";
import type { RentalListing } from "@/lib/mock/types";

const DEFAULTS: FilterLike = { furnishedOnly: false, beds: [], baths: [], types: ["apartment", "house", "condo", "townhome"], rentMin: 500, rentMax: 6000 };

const listing = (over: Partial<RentalListing> = {}): RentalListing => ({
  id: "live--jacksonville--1",
  analysisId: "r--live--jacksonville--1",
  address: "2262 Kingston St",
  city: "Jacksonville",
  stateCode: "FL",
  marketSlug: "jacksonville",
  lat: 30.33,
  lon: -81.66,
  bedrooms: 2,
  bathrooms: 1,
  sqft: 900,
  propertyType: "house",
  rentMonthly: 1450,
  petFriendly: false,
  features: ["Furnished"],
  featuresKnown: true,
  ...over,
});

describe("what an alert asks for", () => {
  it("is nothing in particular from the default filters", () => {
    const c = criteriaFromFilters(DEFAULTS, DEFAULTS);
    expect(c).toEqual({ furnishedOnly: false, beds: [], baths: [], types: [], rentMin: null, rentMax: null });
    expect(describeCriteria(c)).toBe("Any rental");
  });

  it("freezes the filters on screen, sliders at their ends being no bound", () => {
    const c = criteriaFromFilters({ ...DEFAULTS, furnishedOnly: true, beds: [2, 1], types: ["house", "condo"], rentMin: 500, rentMax: 2000 }, DEFAULTS);
    expect(c).toEqual({ furnishedOnly: true, beds: [1, 2], baths: [], types: ["house", "condo"], rentMin: null, rentMax: 2000 });
    expect(describeCriteria(c)).toBe("Furnished · 1–2 bd · up to $2,000 · House, Condo");
    expect(describeCriteria({ ...c, beds: [5], baths: [2, 3], rentMin: 1000 })).toBe("Furnished · 5+ bd · 2–3 ba · $1,000 to $2,000 · House, Condo");
    expect(describeCriteria({ ...c, beds: [1, 3], rentMax: null })).toBe("Furnished · 1, 3 bd · House, Condo");
  });

  it("reads a row back whatever was written there", () => {
    expect(readCriteria(null)).toEqual({ furnishedOnly: false, beds: [], baths: [], types: [], rentMin: null, rentMax: null });
    expect(readCriteria({ furnishedOnly: true, beds: [3, "x", 9], types: ["house", "castle"], rentMax: 1800.4, rentMin: -5 })).toEqual({
      furnishedOnly: true,
      beds: [3],
      baths: [],
      types: ["house"],
      rentMin: null,
      rentMax: 1800,
    });
  });
});

describe("whether a rental is what was asked for", () => {
  const c = criteriaFromFilters({ ...DEFAULTS, furnishedOnly: true, beds: [1, 2], types: ["house"], rentMax: 2000 }, DEFAULTS);

  it("matches on every rule at once", () => {
    expect(matchesCriteria(listing(), c)).toBe(true);
    expect(matchesCriteria(listing({ bedrooms: 3 }), c)).toBe(false);
    expect(matchesCriteria(listing({ propertyType: "condo" }), c)).toBe(false);
    expect(matchesCriteria(listing({ rentMonthly: 2400 }), c)).toBe(false);
    expect(matchesCriteria(listing({ features: [] }), c)).toBe(false);
  });

  it("never rules out a rental whose amenities are unknown, and reads five as five or more", () => {
    expect(matchesCriteria(listing({ features: [], featuresKnown: false }), c)).toBe(true);
    const big = criteriaFromFilters({ ...DEFAULTS, beds: [5] }, DEFAULTS);
    expect(matchesCriteria(listing({ bedrooms: 7 }), big)).toBe(true);
    const halfBath = criteriaFromFilters({ ...DEFAULTS, baths: [2] }, DEFAULTS);
    expect(matchesCriteria(listing({ bathrooms: 2.5 }), halfBath)).toBe(true);
  });
});
