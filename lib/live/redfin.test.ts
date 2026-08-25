import { describe, expect, it } from "vitest";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import {
  extractListings,
  mapRedfinListing,
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

describe("mapRedfinListing", () => {
  const row = {
    address: "1204 Glencoe St",
    city: "Jacksonville",
    state: "FL",
    price: 1850,
    beds: 2,
    baths: 1.5,
    sqFt: 940,
    latitude: 30.33,
    longitude: -81.66,
    propertyType: "Single Family",
    url: "/FL/Jacksonville/1204-Glencoe-St-32211/home/12345",
  };

  it("maps a listing the app can render", () => {
    const l = mapRedfinListing(row, jax, { furnished: true, index: 0 })!;
    expect(l.address).toBe("1204 Glencoe St");
    expect(l.rentMonthly).toBe(1850);
    expect(l.bedrooms).toBe(2);
    expect(l.bathrooms).toBe(1.5);
    expect(l.propertyType).toBe("house");
    expect(l.marketSlug).toBe("jacksonville");
  });

  it("tags Furnished ONLY from a furnished-filtered search", () => {
    // The one amenity claim in this codebase that isn't mined from
    // prose: Redfin applied the filter, so the tag is theirs.
    const yes = mapRedfinListing(row, jax, { furnished: true, index: 0 })!;
    expect(yes.features).toEqual(["Furnished"]);
    expect(yes.featuresKnown).toBe(true);

    // An unfiltered search says nothing about amenities — unknown, not
    // "has none", so a feature filter can't wrongly exclude it.
    const no = mapRedfinListing(row, jax, { furnished: false, index: 0 })!;
    expect(no.features).toEqual([]);
    expect(no.featuresKnown).toBe(false);
  });

  it("reads money and numbers however they are formatted", () => {
    const messy = { ...row, price: "$1,850/mo", beds: "2", sqFt: "940" };
    const l = mapRedfinListing(messy, jax, { furnished: true, index: 0 })!;
    expect(l.rentMonthly).toBe(1850);
    expect(l.bedrooms).toBe(2);
    expect(l.sqft).toBe(940);
  });

  it("reads nested coordinates and addresses", () => {
    const nested = {
      "streetLine": "1204 Glencoe St",
      price: 1850,
      latLong: { latitude: 30.33, longitude: -81.66 },
    };
    const l = mapRedfinListing(nested, jax, { furnished: true, index: 1 })!;
    expect(l.lat).toBeCloseTo(30.33);
    expect(l.lon).toBeCloseTo(-81.66);
  });

  it("drops a row rather than invent what it lacks", () => {
    for (const missing of ["price", "latitude", "address"] as const) {
      const broken: Record<string, unknown> = { ...row };
      delete broken[missing];
      expect(
        mapRedfinListing(broken, jax, { furnished: true, index: 0 }),
        missing
      ).toBeNull();
    }
  });

  it("clamps bedrooms into the range the calculator models", () => {
    const studio = mapRedfinListing({ ...row, beds: 0 }, jax, { furnished: true, index: 0 })!;
    expect(studio.bedrooms).toBe(1);
    const mansion = mapRedfinListing({ ...row, beds: 9 }, jax, { furnished: true, index: 0 })!;
    expect(mansion.bedrooms).toBe(5);
  });

  it("gives every row a stable, market-scoped id", () => {
    const a = mapRedfinListing(row, jax, { furnished: true, index: 0 })!;
    const b = mapRedfinListing(row, jax, { furnished: true, index: 0 })!;
    expect(a.id).toBe(b.id);
    expect(a.id.startsWith("live--jacksonville--rf-")).toBe(true);
    expect(a.analysisId).toBe(`r--${a.id}`);
  });

  it("never carries a description — Redfin's tag replaces the prose", () => {
    const l = mapRedfinListing(row, jax, { furnished: true, index: 0 })!;
    expect(l.description).toBeUndefined();
  });
});
