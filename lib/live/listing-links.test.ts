import { describe, expect, it } from "vitest";
import { hasOwnListingPage, photosHref } from "./listing-links";

const TAMPA = { address: "1234 Palm Ave", city: "Tampa", stateCode: "FL" };

describe("the listing's own page comes first", () => {
  it("links straight to the source listing when the row carries its URL", () => {
    // The exact property, on the site that published it. Nothing beats
    // it, so nothing gets to beat it.
    const own = "https://www.redfin.com/FL/Tampa/1234-Palm-Ave-33602/home/123";
    expect(photosHref({ ...TAMPA, sourceUrl: own })).toBe(own);
  });

  it("refuses a source URL that is not https on the listing site", () => {
    // Read off a vendor payload, so not a navigation target to take on
    // trust. Anything odd falls through to the address search.
    expect(photosHref({ ...TAMPA, sourceUrl: "http://www.redfin.com/x" })).toContain("realtor.com");
    expect(photosHref({ ...TAMPA, sourceUrl: "https://evil.example/redfin.com" })).toContain("realtor.com");
    expect(photosHref({ ...TAMPA, sourceUrl: "javascript:alert(1)" })).toContain("realtor.com");
    expect(photosHref({ ...TAMPA, sourceUrl: "not a url" })).toContain("realtor.com");
  });

  it("accepts the bare and www hosts, and nothing that merely ends in them", () => {
    expect(photosHref({ ...TAMPA, sourceUrl: "https://redfin.com/a" })).toBe("https://redfin.com/a");
    expect(photosHref({ ...TAMPA, sourceUrl: "https://notredfin.com/a" })).toContain("realtor.com");
  });
});

describe("the address search, when there is no page URL", () => {
  it("builds a rental search for the full address", () => {
    expect(photosHref(TAMPA)).toBe(
      "https://www.realtor.com/realestateandhomes-search/1234-Palm-Ave_Tampa_FL"
    );
  });

  it("never sends anybody to Zillow", () => {
    // Their address search resolves often enough to look like it works
    // and misses often enough to be untrustworthy, which is the worst
    // of both: nobody learns to check it.
    for (const place of [
      TAMPA,
      { ...TAMPA, sourceUrl: "https://evil.example/redfin.com" },
      { ...TAMPA, address: "88 W Main St #4B" },
    ]) {
      expect(photosHref(place)).not.toContain("zillow");
    }
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
    // Underscores separate the parts, hyphens fill the spaces inside
    // them, and the apostrophes and full stops in a real address
    // survive both.
    const href = photosHref({
      address: "12 O'Brien St. N.W.",
      city: "St. Petersburg",
      stateCode: "FL",
    })!;
    expect(href).toContain("12-O'Brien-St.-N.W._St.-Petersburg_FL");
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

describe("hasOwnListingPage", () => {
  it("is true only for a usable page on the listing site", () => {
    // The same rule photosHref uses to prefer the row's own URL, so the
    // copy that promises "the lister's details are behind View photos"
    // is true exactly when the link goes to the listing.
    expect(
      hasOwnListingPage({ ...TAMPA, sourceUrl: "https://www.redfin.com/FL/Tampa/x/home/1" })
    ).toBe(true);
    expect(hasOwnListingPage(TAMPA)).toBe(false);
    expect(hasOwnListingPage({ ...TAMPA, sourceUrl: "http://www.redfin.com/x" })).toBe(false);
    expect(hasOwnListingPage({ ...TAMPA, sourceUrl: "https://zillow.com/x" })).toBe(false);
    expect(hasOwnListingPage({ ...TAMPA, sourceUrl: "not a url" })).toBe(false);
  });
});
