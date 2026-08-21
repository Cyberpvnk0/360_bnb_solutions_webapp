import { describe, expect, it } from "vitest";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import { mapRentCastListing, type RentCastListing } from "./rentcast";

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
      id: `live--${JAX.id}`,
      analysisId: `r--live--${JAX.id}`,
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
