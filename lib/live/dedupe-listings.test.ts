import { describe, expect, it } from "vitest";
import { collapseDuplicateListings } from "./dedupe-listings";
import type { RentalListing } from "@/lib/mock/types";

const row = (address: string, extra: Partial<RentalListing> = {}) =>
  ({
    id: `live--${address}`,
    analysisId: "a",
    address,
    city: "Tampa",
    stateCode: "FL",
    marketSlug: "tampa",
    lat: 28.07,
    lon: -82.43,
    bedrooms: 4,
    bathrooms: 3,
    sqft: 2500,
    propertyType: "house",
    rentMonthly: 899,
    petFriendly: false,
    features: [],
    ...extra,
  }) as RentalListing;

const HOUSE = "14716 Carnation Dr, Tampa, FL 33613";
const ROOM = "14716 Carnation Dr Rm 4, Tampa, FL 33613";

describe("one listing written twice", () => {
  it("folds the house and the house with its room number into one card", () => {
    // The pair from the Deal Finder: same rent, beds and size; the
    // baths disagree, as two entries for one place do.
    const out = collapseDuplicateListings([
      row(HOUSE, { bathrooms: 3 }),
      row(ROOM, { bathrooms: 2.5 }),
    ]);
    expect(out).toHaveLength(1);
    // The labelled line knows more, so it is the one shown.
    expect(out[0].address).toBe(ROOM);
  });

  it("folds the same line listed twice", () => {
    const out = collapseDuplicateListings([row(HOUSE), row(HOUSE, { id: "live--again" })]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(`live--${HOUSE}`);
  });

  it("keeps the row that has a page or a contact, and lends the rest what it had", () => {
    const out = collapseDuplicateListings([
      row(ROOM, { features: ["Furnished"], featuresKnown: true }),
      row(HOUSE, { sourceUrl: "https://www.redfin.com/FL/Tampa/x/home/1", zip: "33613" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].address).toBe(HOUSE);
    expect(out[0].sourceUrl).toBe("https://www.redfin.com/FL/Tampa/x/home/1");
    expect(out[0].features).toEqual(["Furnished"]);
    expect(out[0].featuresKnown).toBe(true);
  });

  it("keeps the feed's order", () => {
    const out = collapseDuplicateListings([
      row("1 First St, Tampa, FL 33613", { rentMonthly: 1000 }),
      row(HOUSE),
      row("2 Second St, Tampa, FL 33613", { rentMonthly: 1100 }),
      row(ROOM),
    ]);
    expect(out.map((r) => r.address)).toEqual([
      "1 First St, Tampa, FL 33613",
      ROOM,
      "2 Second St, Tampa, FL 33613",
    ]);
  });
});

describe("what is never folded", () => {
  it("two rooms in one house", () => {
    const out = collapseDuplicateListings([row(ROOM), row("14716 Carnation Dr Rm 5, Tampa, FL 33613")]);
    expect(out).toHaveLength(2);
  });

  it("two units in one building, however alike", () => {
    const out = collapseDuplicateListings([
      row("900 Main St Apt 101, Tampa, FL 33613", { rentMonthly: 1500, bedrooms: 2, sqft: 850 }),
      row("900 Main St Apt 205, Tampa, FL 33613", { rentMonthly: 1500, bedrooms: 2, sqft: 850 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("a different rent, bedroom count or size", () => {
    expect(collapseDuplicateListings([row(HOUSE), row(ROOM, { rentMonthly: 950 })])).toHaveLength(2);
    expect(collapseDuplicateListings([row(HOUSE), row(ROOM, { bedrooms: 3 })])).toHaveLength(2);
    expect(collapseDuplicateListings([row(HOUSE), row(ROOM, { sqft: 2400 })])).toHaveLength(2);
  });

  it("a size the feed did not state", () => {
    // An unknown size proves nothing either way, so the pair stays.
    expect(collapseDuplicateListings([row(HOUSE, { sqft: 0 }), row(ROOM, { sqft: 0 })])).toHaveLength(2);
    expect(collapseDuplicateListings([row(HOUSE), row(ROOM, { sqft: 0 })])).toHaveLength(2);
  });

  it("the same street in another town", () => {
    const out = collapseDuplicateListings([
      row("100 Main St, Tampa, FL 33602"),
      row("100 Main St, Temple Terrace, FL 33617", { city: "Temple Terrace" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("rows whose address cannot be keyed", () => {
    const out = collapseDuplicateListings([row("Address on file"), row("Address on file")]);
    expect(out).toHaveLength(2);
  });
});
