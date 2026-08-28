import { describe, expect, it } from "vitest";
import { photosHref } from "./listing-links";

const TAMPA = { address: "1234 Palm Ave", city: "Tampa", stateCode: "FL" };

describe("the link out to the photos", () => {
  it("builds a rental search for the full address", () => {
    expect(photosHref(TAMPA)).toBe(
      "https://www.zillow.com/homes/for_rent/1234-Palm-Ave,-Tampa,-FL_rb/"
    );
  });

  it("drops a unit marker rather than letting it start a fragment", () => {
    // "#4B" is legal in a path and a fragment start in a browser, which
    // would truncate the address to everything before the unit and
    // search a different place entirely.
    const href = photosHref({ ...TAMPA, address: "88 W Main St #4B" })!;
    expect(href).not.toContain("#");
    expect(href).toContain("88-W-Main-St-4B");
  });

  it("keeps the punctuation their slugs actually use", () => {
    const href = photosHref({
      address: "12 O'Brien St. N.W.",
      city: "St. Petersburg",
      stateCode: "FL",
    })!;
    expect(href).toContain("12-O'Brien-St.-N.W.,-St.-Petersburg,-FL");
  });

  it("collapses runs of whitespace instead of emitting empty segments", () => {
    expect(photosHref({ ...TAMPA, address: "1234   Palm    Ave" })).toBe(
      photosHref(TAMPA)
    );
  });

  it("refuses half an address", () => {
    // A search for a street with no city lands on someone else's house,
    // which looks like a bug and wastes the click.
    expect(photosHref({ ...TAMPA, city: "" })).toBeNull();
    expect(photosHref({ ...TAMPA, address: "" })).toBeNull();
    expect(photosHref({ ...TAMPA, address: "  " })).toBeNull();
  });

  it("survives an address made entirely of punctuation", () => {
    expect(photosHref({ address: "///", city: "Tampa", stateCode: "FL" })).toBeNull();
  });
});
