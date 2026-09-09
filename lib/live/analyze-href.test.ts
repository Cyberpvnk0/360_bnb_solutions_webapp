import { describe, expect, it } from "vitest";
import { analyzeHref, analyzeSearchHref } from "./analyze-href";

const paramsOf = (href: string) => new URL(href, "https://app.example").searchParams;

describe("the ZIP travels into the analysis", () => {
  it("from a listing's own field, or its address line", () => {
    const base = { address: "1804 E Sitka St", lat: 27.99, lon: -82.44, bedrooms: 2, bathrooms: 1, propertyType: "house" };
    expect(paramsOf(analyzeHref({ ...base, zip: "33604" })).get("z")).toBe("33604");
    expect(paramsOf(analyzeHref({ ...base, address: "1804 E Sitka St, Tampa, FL 33604" })).get("z")).toBe("33604");
    expect(paramsOf(analyzeHref(base)).has("z")).toBe(false);
  });

  it("from a searched address's suggestion", () => {
    const place = { address: "1804 E Sitka St, Tampa, FL 33604", street: "1804 E Sitka St", city: "Tampa", state: "FL", point: { lat: 27.99, lon: -82.44 } };
    expect(paramsOf(analyzeSearchHref({ ...place, zip: "33604" })).get("z")).toBe("33604");
    // The provider published none, but the line carries it.
    expect(paramsOf(analyzeSearchHref({ ...place, zip: "" })).get("z")).toBe("33604");
    expect(paramsOf(analyzeSearchHref({ ...place, address: "1804 E Sitka St", zip: "" })).has("z")).toBe(false);
  });
});
