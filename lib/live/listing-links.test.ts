import { describe, expect, it } from "vitest";
import {
  addressSearchHref,
  findingHref,
  hasOwnListingPage,
  pageQuery,
  photoSources,
  photosHref,
  photosLink,
  searchTerms,
  siteSearchHref,
  usableListingPage,
  webLookupHref,
  zillowHref,
} from "./listing-links";

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
    // trust. Anything odd falls through to the finder.
    for (const bad of [
      "http://www.redfin.com/x",
      "https://evil.example/redfin.com",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(photosLink({ ...TAMPA, sourceUrl: bad })?.kind).toBe("finding");
    }
  });

  it("accepts the bare and www hosts, and nothing that merely ends in them", () => {
    expect(photosHref({ ...TAMPA, sourceUrl: "https://redfin.com/a" })).toBe(
      "https://redfin.com/a"
    );
    expect(
      photosLink({ ...TAMPA, sourceUrl: "https://notredfin.com/a" })?.kind
    ).toBe("finding");
  });
});

describe("the four destinations, in order", () => {
  it("lists Redfin, Zillow, Realtor and Google, in that order", () => {
    const ids = photoSources({ ...TAMPA, zip: "33602" }).map((s) => `${s.id}:${s.kind}`);
    expect(ids).toEqual(["redfin:finding", "zillow:search", "realtor:search", "google:search"]);
    // With the row's own page, the first is the listing itself.
    const own = "https://www.redfin.com/FL/Tampa/1234-Palm-Ave-33602/home/123";
    const [first] = photoSources({ ...TAMPA, sourceUrl: own });
    expect(first).toEqual({ id: "redfin", label: "Redfin", href: own, kind: "listing" });
    // The button opens the first; the labels are the sites' names.
    expect(photosLink(TAMPA)?.kind).toBe("finding");
    expect(photoSources(TAMPA).map((s) => s.label)).toEqual(["Redfin", "Zillow", "Realtor", "Google Images"]);
  });

  it("writes Zillow's address page the way their own search does", () => {
    expect(zillowHref(TAMPA)).toBe("https://www.zillow.com/homes/1234-Palm-Ave-Tampa-FL_rb/");
    expect(zillowHref({ ...TAMPA, zip: "33602" })).toBe(
      "https://www.zillow.com/homes/1234-Palm-Ave-Tampa-FL-33602_rb/"
    );
    // A flat: "APT", the way their pages spell it, and never a "#".
    const flat = zillowHref({ ...TAMPA, address: "88 W Main St #4B" })!;
    expect(flat).toBe("https://www.zillow.com/homes/88-W-Main-St-APT-4B-Tampa-FL_rb/");
    expect(zillowHref({ ...TAMPA, address: "12 O'Brien St. N.W.", city: "St. Petersburg" })).toBe(
      "https://www.zillow.com/homes/12-O-Brien-St-N-W-St-Petersburg-FL_rb/"
    );
    expect(zillowHref({ ...TAMPA, city: "" })).toBeNull();
  });

  it("searches realtor.com for the property, on its own", () => {
    const realtor = queryOf(siteSearchHref({ ...TAMPA, address: "1804 East Sitka Street" }, "realtor.com")!);
    expect(realtor).toBe('"1804" "Sitka" Tampa FL site:realtor.com');
    expect(siteSearchHref({ ...TAMPA, city: "" }, "realtor.com")).toBeNull();
  });

  it("searches Google Images for the full address, as written, last", () => {
    const href = addressSearchHref({ ...TAMPA, zip: "33602" })!;
    expect(queryOf(href)).toBe("1234 Palm Ave, Tampa, FL 33602");
    expect(new URL(href).searchParams.get("tbm")).toBe("isch");
    expect(queryOf(addressSearchHref(TAMPA)!)).toBe("1234 Palm Ave, Tampa, FL");
    const last = photoSources({ ...TAMPA, zip: "33602" }).at(-1)!;
    expect(last.id).toBe("google");
    expect(queryOf(last.href)).not.toContain("site:");
  });
});

describe("the searches, when there is no page URL", () => {
  it("quotes the house number and the street's name, and nothing with two spellings", () => {
    // The geocoder writes "1804 East Sitka Street"; the portal's page
    // says "1804 E Sitka St". Quoting the whole line matched neither
    // and the engine answered "no documents" for a listing that was
    // there. The number and the name are spelled one way everywhere.
    const q = queryOf(siteSearchHref({ ...TAMPA, address: "1804 East Sitka Street" }, "realtor.com")!);
    expect(q.startsWith('"1804" "Sitka"')).toBe(true);
    expect(q).not.toContain('"1804 East Sitka Street"');
    expect(q).toContain("Tampa");
    expect(q).toContain("FL");
  });

  it("finds the name past a directional and before the suffix", () => {
    expect(searchTerms("10920 N 29th St")).toEqual({ number: "10920", name: "29th" });
    expect(searchTerms("12 O'Brien St. N.W.")).toEqual({ number: "12", name: "O'Brien" });
    expect(searchTerms("1234 Palm Ave")).toEqual({ number: "1234", name: "Palm" });
    expect(searchTerms("500 Boulevard of the Allies")).toEqual({ number: "500", name: "of" });
  });

  it("stops at a unit marker, which the portal writes its own way", () => {
    expect(searchTerms("88 W Main St #4B")).toEqual({ number: "88", name: "Main" });
    expect(searchTerms("88 W Main St Apt 4B")).toEqual({ number: "88", name: "Main" });
    expect(searchTerms("88 W Main St, Unit 4B")).toEqual({ number: "88", name: "Main" });
  });

  it("quotes a line with no number whole, since nothing else holds it", () => {
    expect(searchTerms("Palm Ave")).toEqual({ number: null, name: "Palm" });
    expect(queryOf(siteSearchHref({ ...TAMPA, address: "The Palms" }, "realtor.com")!)).toContain('"The Palms"');
  });

  it("never lets a unit marker start a fragment, on any destination", () => {
    // "#4B" starts a fragment in a browser, which would truncate the
    // link to everything before the unit.
    for (const source of photoSources({ ...TAMPA, address: "88 W Main St #4B" })) {
      expect(source.href).not.toContain("#");
    }
    expect(queryOf(siteSearchHref({ ...TAMPA, address: "88 W Main St #4B" }, "realtor.com")!)).toContain('"88" "Main"');
  });

  it("keeps the punctuation a real address carries", () => {
    const href = siteSearchHref(
      { address: "12 O'Brien St. N.W.", city: "St. Petersburg", stateCode: "FL" },
      "realtor.com"
    )!;
    expect(queryOf(href)).toContain(`"12" "O'Brien" St. Petersburg FL`);
  });

  it("collapses runs of whitespace instead of emitting empty segments", () => {
    expect(photoSources({ ...TAMPA, address: "1234   Palm    Ave" }).map((s) => s.href)).toEqual(
      photoSources(TAMPA).map((s) => s.href)
    );
  });

  it("refuses half an address", () => {
    // A search for a street with no city returns someone else's house,
    // which looks like a bug and wastes the click.
    expect(photosLink({ ...TAMPA, city: "" })).toBeNull();
    expect(photosLink({ ...TAMPA, address: "" })).toBeNull();
    expect(photosLink({ ...TAMPA, address: "  " })).toBeNull();
    expect(photoSources({ ...TAMPA, city: "" })).toEqual([]);
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

describe("usableListingPage", () => {
  it("returns the page only when it is one the link would open", () => {
    // Shared with the analyze link and the result page's query string,
    // so a page survives the trip exactly when "View photos" would
    // have opened it from the card.
    const own = "https://www.redfin.com/FL/Tampa/1234-Palm-Ave-33602/home/123";
    expect(usableListingPage(own)).toBe(own);
    expect(usableListingPage(undefined)).toBeNull();
    expect(usableListingPage("http://www.redfin.com/x")).toBeNull();
    expect(usableListingPage("https://notredfin.com/a")).toBeNull();
    expect(usableListingPage("javascript:alert(1)")).toBeNull();
    expect(usableListingPage("not a url")).toBeNull();
  });
});

describe("the finder page, for a click while the page is being found", () => {
  it("carries the address to /go/listing", () => {
    const href = findingHref({ ...TAMPA, address: "1804 East Sitka Street" })!;
    const url = new URL(href, "https://app.example");
    expect(url.pathname).toBe("/go/listing");
    expect(url.searchParams.get("address")).toBe("1804 East Sitka Street");
    expect(url.searchParams.get("city")).toBe("Tampa");
    expect(url.searchParams.get("state")).toBe("FL");
  });

  it("has nothing for half an address, like the search", () => {
    expect(findingHref({ ...TAMPA, city: "" })).toBeNull();
    expect(findingHref({ ...TAMPA, address: "//" })).toBeNull();
  });
});

describe("what the page lookup is told", () => {
  it("carries the ZIP and the point when the place has them", () => {
    const q = pageQuery({ ...TAMPA, zip: "33604", point: { lat: 27.99, lon: -82.44 } });
    expect(q.get("address")).toBe("1234 Palm Ave");
    expect(q.get("zip")).toBe("33604");
    expect(q.get("lat")).toBe("27.99");
    expect(q.get("lon")).toBe("-82.44");
    const bare = pageQuery(TAMPA);
    expect(bare.has("zip")).toBe(false);
    expect(bare.has("lat")).toBe(false);
  });

  it("drops a ZIP that is not five digits", () => {
    expect(pageQuery({ ...TAMPA, zip: "3360" }).has("zip")).toBe(false);
  });

  it("goes through to the finder page", () => {
    const href = findingHref({ ...TAMPA, zip: "33604", point: { lat: 27.99, lon: -82.44 } })!;
    const url = new URL(href, "https://app.example");
    expect(url.searchParams.get("zip")).toBe("33604");
    expect(url.searchParams.get("lat")).toBe("27.99");
  });
});

describe("the web lookup, when no listing page could give a contact", () => {
  it("searches the whole web for the rental, pinned to the address", () => {
    const href = webLookupHref({ ...TAMPA, address: "1804 East Sitka Street" })!;
    const url = new URL(href);
    expect(url.hostname).toBe("www.google.com");
    const q = url.searchParams.get("q")!;
    expect(q.startsWith('"1804" "Sitka"')).toBe(true);
    expect(q).toContain("Tampa FL");
    expect(q).toContain("for rent");
    expect(q).not.toContain("site:");
  });

  it("has nothing for half an address", () => {
    expect(webLookupHref({ ...TAMPA, city: "" })).toBeNull();
  });
});
