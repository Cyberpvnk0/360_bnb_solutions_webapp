import { describe, expect, it } from "vitest";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import {
  featuresFromFeed,
  mapRentCastListing,
  type RentCastListing,
} from "./rentcast";

/** Shaped like RentCast's documented /listings/rental/long-term rows. */
const JAX: RentCastListing = {
  id: "1054-Riverside-Ave,-Jacksonville,-FL-32204",
  formattedAddress: "1054 Riverside Ave, Jacksonville, FL 32204",
  addressLine1: "1054 Riverside Ave",
  city: "Jacksonville",
  state: "FL",
  latitude: 30.318,
  longitude: -81.669,
  propertyType: "Single Family",
  bedrooms: 3,
  bathrooms: 2,
  squareFootage: 1480,
  price: 1795,
  status: "Active",
  daysOnMarket: 12,
  listedDate: "2026-08-09T00:00:00.000Z",
};

const market = MARKET_BY_SLUG.get("jacksonville")!;

describe("rentcast mapper", () => {
  it("maps a documented row onto RentalListing exactly", () => {
    const l = mapRentCastListing(JAX, market);
    expect(l).not.toBeNull();
    expect(l).toMatchObject({
      // The market slug rides in the id so a server render can resolve
      // this listing back from the cached feed.
      id: `live--jacksonville--${JAX.id}`,
      analysisId: `r--live--jacksonville--${JAX.id}`,
      address: "1054 Riverside Ave",
      city: "Jacksonville",
      stateCode: "FL",
      marketSlug: "jacksonville",
      lat: 30.318,
      lon: -81.669,
      bedrooms: 3,
      bathrooms: 2,
      sqft: 1480,
      propertyType: "house",
      rentMonthly: 1795,
      daysOnMarket: 12,
      petFriendly: false,
      features: [],
    });
  });

  it("maps every leasable type and skips the rest", () => {
    const t = (propertyType: string) =>
      mapRentCastListing({ ...JAX, propertyType }, market)?.propertyType;
    expect(t("Condo")).toBe("condo");
    expect(t("Townhouse")).toBe("townhome");
    expect(t("Apartment")).toBe("apartment");
    expect(t("Multi-Family")).toBe("apartment");
    expect(mapRentCastListing({ ...JAX, propertyType: "Land" }, market)).toBeNull();
    expect(
      mapRentCastListing({ ...JAX, propertyType: "Manufactured" }, market)
    ).toBeNull();
  });

  it("carries the feed's own contact, and invents none when absent", () => {
    const withAgent = mapRentCastListing(
      {
        ...JAX,
        listingAgent: {
          name: "Dana Whitfield",
          phone: "(904) 555-0142",
          email: "dana@example.com",
        },
        listingOffice: { name: "Riverside Realty" },
      },
      market
    );
    expect(withAgent?.contact).toEqual({
      name: "Dana Whitfield",
      company: "Riverside Realty",
      phone: "(904) 555-0142",
      email: "dana@example.com",
      role: "Listing agent",
    });
    // A real address with a made-up phone number would be worse than none.
    expect(mapRentCastListing(JAX, market)?.contact).toBeUndefined();
  });

  it("mines amenity tags from whatever descriptive text the feed sends", () => {
    expect(
      featuresFromFeed({
        ...JAX,
        description:
          "Fully furnished 3BR with a private pool, washer and dryer in " +
          "unit, and a fenced yard. Pets allowed.",
      })
    ).toEqual(
      expect.arrayContaining([
        "Furnished",
        "Pet friendly",
        "Private pool",
        "Washer & dryer",
        "Fenced yard",
      ])
    );
    // An amenities array works the same way.
    expect(
      featuresFromFeed({ ...JAX, amenities: ["Garage", "Hot tub"] })
    ).toEqual(["Hot tub", "Garage"].sort((a, b) => a.localeCompare(b)).length
      ? expect.arrayContaining(["Garage", "Hot tub"])
      : []);
  });

  it("distinguishes 'no amenities' from 'no amenity data'", () => {
    // Text present but nothing matched → known, and genuinely empty.
    const known = featuresFromFeed({ ...JAX, description: "Available now." });
    expect(known).toEqual([]);
    // No text field at all → unknown, which the UI must not read as zero.
    expect(featuresFromFeed(JAX)).toBeNull();

    const blind = mapRentCastListing(JAX, market);
    expect(blind?.features).toEqual([]);
    expect(blind?.featuresKnown).toBe(false);

    const seeing = mapRentCastListing(
      { ...JAX, description: "Furnished loft" },
      market
    );
    expect(seeing?.features).toEqual(["Furnished"]);
    expect(seeing?.featuresKnown).toBe(true);
    expect(seeing?.petFriendly).toBe(false);
  });

  it("rejects rows the product can't stand behind", () => {
    expect(mapRentCastListing({ ...JAX, price: 0 }, market)).toBeNull();
    expect(mapRentCastListing({ ...JAX, price: undefined }, market)).toBeNull();
    expect(mapRentCastListing({ ...JAX, latitude: undefined }, market)).toBeNull();
    expect(mapRentCastListing({ ...JAX, bedrooms: undefined }, market)).toBeNull();
  });

  it("treats a studio as 1 bd and clamps 6+ to the 5 bd factor ceiling", () => {
    expect(mapRentCastListing({ ...JAX, bedrooms: 0 }, market)?.bedrooms).toBe(1);
    expect(mapRentCastListing({ ...JAX, bedrooms: 7 }, market)?.bedrooms).toBe(5);
  });
});
