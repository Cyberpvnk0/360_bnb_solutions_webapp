import { describe, expect, it } from "vitest";

import { matchesFilters } from "./deals-explorer";
import { DEFAULT_DEAL_FILTERS } from "./deal-filters";
import type { RentalListing } from "@/lib/mock/types";

/**
 * Beds and baths select exact sizes, not a minimum.
 *
 * The distinction is the whole point of the control: someone shopping
 * one-bedroom arbitrage does not want a five-bed in the list, and a
 * "1+" floor hands them every one.
 */
function row(bedrooms: number, bathrooms: number) {
  const listing = {
    id: "live--tampa--1",
    analysisId: "r--live--tampa--1",
    address: "1 Test St",
    city: "Tampa",
    stateCode: "FL",
    marketSlug: "tampa",
    lat: 27.9,
    lon: -82.4,
    bedrooms,
    bathrooms,
    sqft: 900,
    propertyType: "house",
    rentMonthly: 2000,
    petFriendly: false,
    features: [],
  } as unknown as RentalListing;
  return {
    listing,
    deal: { cushionPts: 0, netCashFlow: 0, nightlyRate: 0, breakeven: 0 },
    haystack: "tampa florida fl",
    keywordHaystack: "",
  };
}

const filters = (patch: Partial<typeof DEFAULT_DEAL_FILTERS>) => ({
  ...DEFAULT_DEAL_FILTERS,
  ...patch,
});

describe("bed and bath selection", () => {
  it("keeps everything when nothing is selected", () => {
    for (const beds of [1, 2, 5, 9]) {
      expect(matchesFilters(row(beds, 2), filters({}))).toBe(true);
    }
  });

  it("excludes larger homes, which a minimum could not", () => {
    const oneBedOnly = filters({ beds: [1] });
    expect(matchesFilters(row(1, 1), oneBedOnly)).toBe(true);
    expect(matchesFilters(row(2, 1), oneBedOnly)).toBe(false);
    expect(matchesFilters(row(5, 1), oneBedOnly)).toBe(false);
  });

  it("takes several sizes at once, and only those", () => {
    const oneOrTwo = filters({ beds: [1, 2] });
    expect(matchesFilters(row(1, 1), oneOrTwo)).toBe(true);
    expect(matchesFilters(row(2, 1), oneOrTwo)).toBe(true);
    expect(matchesFilters(row(3, 1), oneOrTwo)).toBe(false);
  });

  it("treats the top tile as open-ended", () => {
    const fivePlus = filters({ beds: [5] });
    expect(matchesFilters(row(5, 1), fivePlus)).toBe(true);
    expect(matchesFilters(row(8, 1), fivePlus)).toBe(true);
    expect(matchesFilters(row(4, 1), fivePlus)).toBe(false);
  });

  it("counts a half bath down, the way people say it", () => {
    // 2.5 baths is a two-bath house in every listing anyone reads.
    const twoBath = filters({ baths: [2] });
    expect(matchesFilters(row(3, 2), twoBath)).toBe(true);
    expect(matchesFilters(row(3, 2.5), twoBath)).toBe(true);
    expect(matchesFilters(row(3, 3), twoBath)).toBe(false);
    expect(matchesFilters(row(3, 1.5), twoBath)).toBe(false);
  });

  it("applies beds and baths together", () => {
    const both = filters({ beds: [2], baths: [1] });
    expect(matchesFilters(row(2, 1), both)).toBe(true);
    expect(matchesFilters(row(2, 3), both)).toBe(false);
    expect(matchesFilters(row(4, 1), both)).toBe(false);
  });
});
