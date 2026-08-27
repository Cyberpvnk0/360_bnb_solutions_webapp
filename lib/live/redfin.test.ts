import { describe, expect, it } from "vitest";

import type { Market } from "@/lib/mock/types";
import { MARKET_BY_SLUG, MARKETS } from "@/lib/mock/markets";
import { REDFIN_CITY_ID } from "./redfin-city";
import {
  REDFIN_SEARCH_ENDPOINT,
  harvestPhotos,
  nextPageUrls,
  extractListings,
  mapRedfinListing,
  priceOf,
  redfinCoversMarket,
  looksSpent,
  redfinRentalsUrlFor,
} from "./redfin";

const jax = MARKET_BY_SLUG.get("jacksonville")!;

describe("redfinRentalsUrlFor", () => {
  it("builds the real URL shape, filter included", () => {
    expect(redfinRentalsUrlFor(jax, 8907)).toBe(
      "https://www.redfin.com/city/8907/FL/Jacksonville/rentals"
    );
    expect(redfinRentalsUrlFor(jax, 8907, { furnished: true })).toBe(
      "https://www.redfin.com/city/8907/FL/Jacksonville/rentals/filter/is-furnished"
    );
  });

  it("hyphenates multi-word city names", () => {
    const multi = { ...jax, name: "St Petersburg", stateCode: "FL" };
    expect(redfinRentalsUrlFor(multi, 1234)).toContain(
      "/FL/St-Petersburg/rentals"
    );
  });

  it("knows which markets are seeded without going to ask", () => {
    expect(redfinCoversMarket(jax)).toBe(true);
    // Chosen from the map rather than named, so seeding a market later
    // can't quietly turn this into a test of nothing.
    const unseeded = MARKETS.find(
      (m) => REDFIN_CITY_ID[m.slug] === undefined
    );
    if (unseeded) expect(redfinCoversMarket(unseeded)).toBe(false);
  });
});

describe("extractListings", () => {
  const rows = [{ price: 1 }, { price: 2 }];

  it("finds the array wherever the response wraps it", () => {
    // Pinned from the live response: the container is `listing`.
    expect(extractListings({ listing: rows })).toHaveLength(2);
    expect(extractListings(rows)).toHaveLength(2);
    expect(extractListings({ homes: rows })).toHaveLength(2);
    expect(extractListings({ listings: rows })).toHaveLength(2);
    expect(extractListings({ data: { homes: rows } })).toHaveLength(2);
  });

  it("returns empty rather than throwing on a shape we didn't expect", () => {
    expect(extractListings(null)).toEqual([]);
    expect(extractListings({ error: "nope" })).toEqual([]);
  });
});

/** A row shaped like the live response: display strings, price wrapped
 *  in an array of objects, and no coordinates anywhere. */
const row = {
  address: "1204 Glencoe St, Jacksonville, FL 32211",
  number_beds: "2 beds",
  number_baths: "1.5 baths",
  sq_ft: "940 sq ft",
  price: [{ value: "$1,850/mo" }],
  key_facts: ["In-unit W/D", "Pool", "Pets OK"],
  url: "/FL/Jacksonville/1204-Glencoe-St-32211/home/12345",
  badge: [],
  phone: "",
};

const COORDS = { lat: 30.33, lon: -81.66 };

function mapped(over: Record<string, unknown> = {}, furnished = true) {
  const result = mapRedfinListing({ ...row, ...over }, jax, {
    furnished,
    index: 0,
    coords: COORDS,
  });
  return result.ok ? result.listing : null;
}

describe("priceOf", () => {
  it("digs the rent out of an array of objects", () => {
    expect(priceOf(row)).toBe(1850);
  });

  it("reads a plain number or a formatted string too", () => {
    expect(priceOf({ price: 1850 })).toBe(1850);
    expect(priceOf({ price: "$1,850/mo" })).toBe(1850);
  });

  it("ignores small numbers that aren't rent", () => {
    // "1 of 3" and bedroom counts live in the same objects as the price.
    expect(priceOf({ price: [{ label: "1", unit: "3" }] })).toBeUndefined();
  });

  it("returns undefined rather than guessing", () => {
    expect(priceOf({})).toBeUndefined();
    expect(priceOf({ price: [] })).toBeUndefined();
  });
});

describe("mapRedfinListing", () => {
  it("reads Redfin's display strings as numbers", () => {
    const l = mapped()!;
    expect(l.rentMonthly).toBe(1850);
    expect(l.bedrooms).toBe(2);
    expect(l.bathrooms).toBe(1.5);
    expect(l.sqft).toBe(940);
    expect(l.address).toBe("1204 Glencoe St, Jacksonville, FL 32211");
  });

  it("tags Furnished ONLY from a furnished-filtered search", () => {
    // The one amenity claim in this codebase that isn't mined from
    // prose: Redfin applied the filter, so the tag is theirs.
    expect(mapped()!.features).toContain("Furnished");
    expect(mapped()!.featuresKnown).toBe(true);

    const unfiltered = mapped({}, false)!;
    expect(unfiltered.features).not.toContain("Furnished");
    expect(unfiltered.featuresKnown).toBe(false);
  });

  it("mines the key_facts chips through the one shared miner", () => {
    const l = mapped()!;
    expect(l.features).toEqual(
      expect.arrayContaining(["Washer & dryer", "Private pool", "Pet friendly"])
    );
    expect(l.petFriendly).toBe(true);
  });

  it("applies the miner's negations to chips as well", () => {
    const l = mapped({ key_facts: ["No pets", "Street parking only"] })!;
    expect(l.features).not.toContain("Pet friendly");
    expect(l.features).not.toContain("Garage");
  });

  it("skips a row with no coordinates rather than pinning the city centre", () => {
    // Redfin's search rows carry no lat/lon. A pin on the wrong street
    // is a lie a student would drive to.
    const result = mapRedfinListing(row, jax, { furnished: true, index: 0 });
    expect(result).toEqual({ ok: false, skip: "no-coordinates" });
  });

  it("names why each unusable row was dropped", () => {
    const noPrice = mapRedfinListing({ ...row, price: [] }, jax, {
      furnished: true,
      index: 0,
      coords: COORDS,
    });
    expect(noPrice).toEqual({ ok: false, skip: "no-price" });

    const noAddress = mapRedfinListing(
      { ...row, address: undefined },
      jax,
      { furnished: true, index: 0, coords: COORDS }
    );
    expect(noAddress).toEqual({ ok: false, skip: "no-address" });
  });

  it("clamps bedrooms into the range the calculator models", () => {
    expect(mapped({ number_beds: "Studio" })!.bedrooms).toBe(1);
    expect(mapped({ number_beds: "9 beds" })!.bedrooms).toBe(5);
  });

  it("skips a row whose bedroom count it cannot read", () => {
    // Defaulting to 1 would quietly understate real two- and
    // three-bedroom units across a whole market, and the cushion maths
    // is built on bedroom count.
    const result = mapRedfinListing({ ...row, number_beds: "— beds" }, jax, {
      furnished: true,
      index: 0,
      coords: COORDS,
    });
    expect(result).toEqual({ ok: false, skip: "no-beds" });
  });

  it("leaves the listing date absent rather than claiming today", () => {
    // Redfin's search rows carry no listing date. Zero would badge every
    // one of eighty listings "New, listed today".
    expect(mapped()!.daysOnMarket).toBeUndefined();
  });

  it("carries the real thumbnail when Redfin ships one", () => {
    const l = mapped({ thumbnail_img_url: "https://ssl.cdn-redfin.com/x.jpg" })!;
    expect(l.photoUrl).toBe("https://ssl.cdn-redfin.com/x.jpg");
    expect(mapped({ thumbnail_img_url: undefined })!.photoUrl).toBeUndefined();
  });

  it("gives every row a stable, market-scoped id", () => {
    const a = mapped()!;
    const b = mapped()!;
    expect(a.id).toBe(b.id);
    expect(a.id.startsWith("live--jacksonville--rf-")).toBe(true);
    expect(a.analysisId).toBe(`r--${a.id}`);
  });

  it("never carries a description — Redfin's tag replaces the prose", () => {
    expect(mapped()!.description).toBeUndefined();
  });
});

describe("the endpoint itself", () => {
  it("is the versioned path", () => {
    // The unversioned path answers and bills but returns nothing
    // readable, which reads as an empty market rather than a wrong URL.
    // Confirmed against ScraperAPI's own generated snippet.
    expect(REDFIN_SEARCH_ENDPOINT).toBe(
      "https://api.scraperapi.com/structured/redfin/search/v1"
    );
  });
});

describe("nextPageUrls", () => {
  it("reads the links a search hands back", () => {
    // Redfin paginates at ~41 rows. Reading only page one shows a third
    // of a market and reads as a narrower search than the one that ran.
    expect(
      nextPageUrls({
        next_pages: [
          "/city/8907/FL/Jacksonville/rentals/filter/is-furnished/page-2",
          "https://www.redfin.com/city/8907/FL/Jacksonville/rentals/filter/is-furnished/page-3",
        ],
      })
    ).toEqual([
      "https://www.redfin.com/city/8907/FL/Jacksonville/rentals/filter/is-furnished/page-2",
      "https://www.redfin.com/city/8907/FL/Jacksonville/rentals/filter/is-furnished/page-3",
    ]);
  });

  it("returns nothing on the last page", () => {
    expect(nextPageUrls({ listing: [] })).toEqual([]);
    expect(nextPageUrls(null)).toEqual([]);
  });
});


describe("harvestPhotos", () => {
  it("finds image URLs wherever the payload keeps them", () => {
    // Schema-independent on purpose: photo arrays get renamed, a JPEG
    // link stays recognisable.
    const body = {
      media: { gallery: [{ src: "https://ssl.cdn-redfin.com/a.jpg" }] },
      hero: "https://ssl.cdn-redfin.com/b.png",
    };
    expect(harvestPhotos(body)).toEqual([
      "https://ssl.cdn-redfin.com/a.jpg",
      "https://ssl.cdn-redfin.com/b.png",
    ]);
  });

  it("ignores links that aren't images", () => {
    expect(
      harvestPhotos({ url: "https://www.redfin.com/FL/Jacksonville/home/1" })
    ).toEqual([]);
  });

  it("returns each photo once", () => {
    const dup = "https://ssl.cdn-redfin.com/a.jpg";
    expect(harvestPhotos({ a: dup, b: dup })).toEqual([dup]);
  });
});

describe("redfinRentalsUrlFor property type", () => {
  const market = {
    name: "Jacksonville",
    stateCode: "FL",
  } as unknown as Market;

  it("asks for houses when the default search won't surface them", () => {
    // Measured against the live search: this form returns real houses,
    // where the unfiltered one is nearly all managed communities.
    expect(redfinRentalsUrlFor(market, 8907, { propertyType: "house" })).toBe(
      "https://www.redfin.com/city/8907/FL/Jacksonville/rentals/filter/property-type=house"
    );
  });

  it("stacks furnished alongside a type", () => {
    expect(
      redfinRentalsUrlFor(market, 8907, {
        furnished: true,
        propertyType: "house",
      })
    ).toBe(
      "https://www.redfin.com/city/8907/FL/Jacksonville/rentals/filter/is-furnished,property-type=house"
    );
  });

  it("cannot build the comma-joined form that silently voids the filter", () => {
    // "property-type=house,townhouse" measured identical to the
    // unfiltered search — the extra value doesn't widen the filter, it
    // disables it, and a row count cannot tell the two apart. The type
    // is a single string so that URL has no way to be constructed.
    const url = redfinRentalsUrlFor(market, 8907, { propertyType: "house" });
    expect(url).not.toContain(",");
    expect(url.match(/property-type=/g) ?? []).toHaveLength(1);
  });

  it("is unchanged when nothing is asked of it", () => {
    expect(redfinRentalsUrlFor(market, 8907)).toBe(
      "https://www.redfin.com/city/8907/FL/Jacksonville/rentals"
    );
  });
});

describe("a spent plan is not a forbidden domain", () => {
  it("reads the vendor's own wording", () => {
    // Both answer 403. One is a code problem, the other is a billing
    // page, and calling the second "forbidden" sends whoever reads the
    // log hunting for a blocked domain that was never blocked.
    const spent =
      "You have exhausted the API Credits available in this monthly cycle. You can upgrade your subscription or enable overages from your dashboard";
    expect(looksSpent(spent)).toBe(true);
    expect(looksSpent("Please upgrade your plan to gain access")).toBe(true);
  });

  it("does not claim a genuinely blocked domain is a billing problem", () => {
    expect(
      looksSpent("Protected domains may require adding premium=true")
    ).toBe(false);
    expect(looksSpent("Invalid API key")).toBe(false);
    expect(looksSpent("")).toBe(false);
  });
});
