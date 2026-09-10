import { describe, expect, it } from "vitest";
import { listingForAnalysis, listingIdForAnalysis } from "./analysis-listing";
import { buildAddressAnalysis } from "./address-analysis";
import { isListing } from "@/lib/storage/deal-lists";

const POINT = { lat: 30.33, lon: -81.66 };
const spec = {
  address: "2262 Kingston St",
  lat: POINT.lat,
  lon: POINT.lon,
  bedrooms: 3,
  bathrooms: 1,
  propertyType: "house" as const,
  rentMonthly: 979,
  city: "Jacksonville",
  stateCode: "FL",
  zip: "32209",
  sourceUrl: "https://www.redfin.com/FL/Jacksonville/2262-Kingston-St-32209/home/1",
};

describe("the listing a result stands for", () => {
  it("is the Deal Finder's own row when the URL carried its id", () => {
    const { analysis } = buildAddressAnalysis(spec);
    const l = listingForAnalysis(analysis, { listingId: "live--jacksonville--abc", point: POINT })!;
    expect(l.id).toBe("live--jacksonville--abc");
    expect(l.analysisId).toBe(analysis.id);
  });

  it("names a live row's listing from its analysis, and mints a stable one for a typed address", () => {
    expect(listingIdForAnalysis("r--live--jacksonville--rf-2262")).toBe("live--jacksonville--rf-2262");
    expect(listingIdForAnalysis("addr--k3j2h")).toBe("rl--addr--k3j2h");
    const { analysis } = buildAddressAnalysis(spec);
    const once = listingForAnalysis(analysis, { point: POINT })!;
    const again = listingForAnalysis(buildAddressAnalysis(spec).analysis, { point: POINT })!;
    expect(once.id).toBe(again.id);
    expect(listingForAnalysis(analysis, { listingId: "  ", point: POINT })!.id).toBe(once.id);
  });

  it("carries the property's facts and invents none", () => {
    const { analysis } = buildAddressAnalysis(spec);
    const l = listingForAnalysis(analysis, { point: POINT, typeKnown: false })!;
    expect(isListing(l)).toBe(true);
    expect(l).toMatchObject({
      address: "2262 Kingston St",
      city: "Jacksonville",
      stateCode: "FL",
      zip: "32209",
      marketSlug: analysis.marketSlug,
      lat: POINT.lat,
      lon: POINT.lon,
      bedrooms: 3,
      bathrooms: 1,
      propertyType: "house",
      propertyTypeKnown: false,
      rentMonthly: 979,
      sourceUrl: spec.sourceUrl,
      sqft: 0,
      features: [],
      featuresKnown: false,
    });
    expect(l.contact).toBeUndefined();
    expect(l.daysOnMarket).toBeUndefined();
    // A stated type is not marked as assumed.
    expect(listingForAnalysis(analysis, { point: POINT })!.propertyTypeKnown).toBeUndefined();
  });

  it("opens on the rent the calculator opened on: asking rent, or the comp median", () => {
    const asked = buildAddressAnalysis(spec).analysis;
    expect(listingForAnalysis(asked, { point: POINT })!.rentMonthly).toBe(979);
    const estimated = buildAddressAnalysis({ ...spec, rentMonthly: undefined }).analysis;
    const l = listingForAnalysis(estimated, { point: POINT })!;
    expect(l.rentMonthly).toBe(Math.round(estimated.defaults.monthlyRent));
    expect(l.rentMonthly).toBeGreaterThan(0);
  });

  it("has no row to file without a point", () => {
    const { analysis } = buildAddressAnalysis(spec);
    expect(listingForAnalysis(analysis, { point: null })).toBeNull();
  });
});
