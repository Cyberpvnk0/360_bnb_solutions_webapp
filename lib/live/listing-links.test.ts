import { describe, expect, it } from "vitest";
import { hasOwnListingPage, photosHref, photosLink } from "./listing-links";

const TAMPA = { address: "1234 Palm Ave", city: "Tampa", stateCode: "FL" };

/** The query string a fallback search was built from, decoded. */
function queryOf(href: string): string {
  return new URL(href).searchParams.get("q") ?? "";
}

describe("the listing's own page comes first", () => {
  it("links straight to the source listing when the row carries its URL", () => {
    // The exact property, on the site that published it. Nothing beats
    // it, so nothing gets to beat it.
    const own = "https://www.redfin.com/FL/Tampa/1234-Palm-Ave-33602/home/123";
    expect(photosLink({ ...TAMPA, sourceUrl: own })).toEqual({
      href: own,
      kind: "listing",
    });
  });

  it("refuses a source URL that is not https on the listing site", () => {
    // Read off a vendor payload, so not a navigation target to take on
    // trust. Anything odd falls through to the address search.
    for (const bad of [
      "http://www.redfin.com/x",
      "https://evil.example/redfin.com",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(photosLink({ ...TAMPA, sourceUrl: bad })?.kind).toBe("search");
    }
  });

  it("accepts the bare and www hosts, and nothing that merely ends in them", () => {
    expect(photosHref({ ...TAMPA, sourceUrl: "https://redfin.com/a" })).toBe(
      "https://redfin.com/a"
    );
    expect(
      photosLink({ ...TAMPA, sourceUrl: "https://notredfin.com/a" })?.kind
    ).toBe("search");
  });
});

describe("the fallback search, when there is no page URL", () => {
  it("searches for the exact address on the two listing sites", () => {
    // Correct by construction: neither portal exposes a URL that
    // resolves a street address, so the engine's index does the
    // resolving and there is no internal id to guess wrong.
    const q = queryOf(photosHref(TAMPA)!);
    expect(q).toContain('"1234 Palm Ave"');
    expect(q).toContain("Tampa");
    expect(q).toContain("FL");
    expect(q).toContain("site:redfin.com");
    expect(q).toContain("site:realtor.com");
  });

  it("quotes the street line so the engine matches it rather than the area", () => {
    // Unquoted, "1234 Palm Ave Tampa FL" ranks the market page — which
    // is exactly what twenty clicked properties all landed on.
    expect(queryOf(photosHref(TAMPA)!).startsWith('"1234 Palm Ave"')).toBe(true);
  });

  it("scopes the search rather than turning an address loose on the web", () => {
    // A bare address search returns lead-generation pages that exist to
    // harvest a phone number, not the listing.
    const url = new URL(photosHref(TAMPA)!);
    expect(url.hostname).toBe("www.google.com");
    expect(queryOf(url.toString())).toContain("(site:redfin.com OR site:realtor.com)");
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
    // "#4B" starts a fragment in a browser, which would truncate the
    // query to everything before the unit.
    const href = photosHref({ ...TAMPA, address: "88 W Main St #4B" })!;
    expect(href).not.toContain("#");
    expect(queryOf(href)).toContain('"88 W Main St 4B"');
  });

  it("keeps the punctuation a real address carries", () => {
    const href = photosHref({
      address: "12 O'Brien St. N.W.",
      city: "St. Petersburg",
      stateCode: "FL",
    })!;
    expect(queryOf(href)).toContain(`"12 O'Brien St. N.W." St. Petersburg FL`);
  });

  it("collapses runs of whitespace instead of emitting empty segments", () => {
    expect(photosHref({ ...TAMPA, address: "1234   Palm    Ave" })).toBe(
      photosHref(TAMPA)
    );
  });

  it("refuses half an address", () => {
    // A search for a street with no city returns someone else's house,
    // which looks like a bug and wastes the click.
    expect(photosLink({ ...TAMPA, city: "" })).toBeNull();
    expect(photosLink({ ...TAMPA, address: "" })).toBeNull();
    expect(photosLink({ ...TAMPA, address: "  " })).toBeNull();
  });

  it("survives an address made entirely of punctuation", () => {
    expect(
      photosLink({ address: "///", city: "Tampa", stateCode: "FL" })
    ).toBeNull();
  });
});

describe("hasOwnListingPage", () => {
  it("is true only for a usable page on the listing site", () => {
    // The same rule photosLink uses to prefer the row's own URL, so the
    // copy that promises "the lister's details are behind View photos"
    // is true exactly when the link goes to the listing.
    expect(
      hasOwnListingPage({
        ...TAMPA,
        sourceUrl: "https://www.redfin.com/FL/Tampa/x/home/1",
      })
    ).toBe(true);
    expect(hasOwnListingPage(TAMPA)).toBe(false);
    expect(hasOwnListingPage({ ...TAMPA, sourceUrl: "http://www.redfin.com/x" })).toBe(
      false
    );
    expect(hasOwnListingPage({ ...TAMPA, sourceUrl: "https://zillow.com/x" })).toBe(
      false
    );
    expect(hasOwnListingPage({ ...TAMPA, sourceUrl: "not a url" })).toBe(false);
  });
});
