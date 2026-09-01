import { describe, expect, it } from "vitest";
import { photosHref, portalLinks } from "./listing-links";

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

describe("the three portals", () => {
  it("offers all three, best first", () => {
    const links = portalLinks(TAMPA);
    expect(links.map((l) => l.id)).toEqual(["zillow", "redfin", "realtor"]);
    // Only one of them can be addressed by address; the other two need
    // an internal id we do not hold, and saying so is what stops
    // somebody "fixing" them into guessed URLs that 404.
    expect(links.map((l) => l.direct)).toEqual([true, false, false]);
  });

  it("searches the rental side, not the for-sale side", () => {
    // Landing on a buy page for a lease is a wrong answer that looks
    // like a right one.
    expect(portalLinks(TAMPA)[0].href).toContain("/for_rent/");
  });

  it("pins the fallback searches to one site and quotes the street", () => {
    const [, redfin, realtor] = portalLinks(TAMPA);
    const q = (href: string) =>
      decodeURIComponent(new URL(href).searchParams.get("q") ?? "");
    expect(q(redfin.href)).toBe('site:redfin.com "1234 Palm Ave" Tampa FL');
    expect(q(realtor.href)).toBe('site:realtor.com "1234 Palm Ave" Tampa FL');
  });

  it("offers nothing at all for half an address", () => {
    expect(portalLinks({ ...TAMPA, city: "" })).toEqual([]);
    expect(portalLinks({ address: "///", city: "Tampa", stateCode: "FL" })).toEqual([]);
  });

  it("keeps a unit marker out of every href, not just the first", () => {
    // "#4B" starts a fragment in a browser. One portal getting this
    // right and two getting it wrong is the bug this asserts against.
    for (const link of portalLinks({ ...TAMPA, address: "88 W Main St #4B" })) {
      expect(link.href).not.toContain("#");
    }
  });
});
