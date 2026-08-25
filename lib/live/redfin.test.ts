import { describe, expect, it } from "vitest";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import {
  REDFIN_SEARCH_ENDPOINT,
  addressKey,
  harvestPhotos,
  nextPageUrls,
  extractListings,
  mapRedfinListing,
  priceOf,
  redfinCoversMarket,
  redfinRentalsUrl,
} from "./redfin";

const jax = MARKET_BY_SLUG.get("jacksonville")!;

describe("redfinRentalsUrl", () => {
  it("builds the real URL shape, filter included", () => {
    expect(redfinRentalsUrl(jax)).toBe(
      "https://www.redfin.com/city/8907/FL/Jacksonville/rentals"
    );
    expect(redfinRentalsUrl(jax, { furnished: true })).toBe(
      "https://www.redfin.com/city/8907/FL/Jacksonville/rentals/filter/is-furnished"
    );
  });

  it("returns null for a market with no known city id", () => {
    // Redfin keys cities by an opaque number. Guessing one would search
    // a different city entirely and report its rentals as this market's.
    const tampa = MARKET_BY_SLUG.get("tampa")!;
    expect(redfinCoversMarket(tampa)).toBe(false);
    expect(redfinRentalsUrl(tampa)).toBeNull();
  });

  it("hyphenates multi-word city names", () => {
    const multi = { ...jax, name: "St Petersburg", stateCode: "FL" };
    expect(redfinRentalsUrl(multi)).toContain("/FL/St-Petersburg/rentals");
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

describe("addressKey", () => {
  it("matches the same building written two ways", () => {
    // RentCast and Redfin write the same address differently; this is
    // what decides they are the same building.
    expect(addressKey("1204 Glencoe Street, Jacksonville, FL 32211")).toBe(
      addressKey("1204 Glencoe St, Jacksonville, FL 32211")
    );
    expect(addressKey("4092 Barnes Rd S, Apt 902, Jacksonville, FL")).toBe(
      addressKey("4092 Barnes Rd S #902, Jacksonville, FL")
    );
  });

  it("keeps different buildings apart", () => {
    // A loose key hangs one property's photo on another's card — wrong
    // in a way that looks completely right.
    expect(addressKey("1204 Glencoe St, Jacksonville, FL")).not.toBe(
      addressKey("1206 Glencoe St, Jacksonville, FL")
    );
    expect(addressKey("1204 Glencoe St, Jacksonville, FL")).not.toBe(
      addressKey("1204 Hubbard St, Jacksonville, FL")
    );
  });

  it("keeps units in the same building apart", () => {
    expect(addressKey("900 Main St Unit 1, Jacksonville, FL")).not.toBe(
      addressKey("900 Main St Unit 2, Jacksonville, FL")
    );
  });

  it("refuses to key an address it cannot parse", () => {
    // No key means no match, which means no borrowed photo.
    expect(addressKey("Address on file")).toBeNull();
    expect(addressKey("")).toBeNull();
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
