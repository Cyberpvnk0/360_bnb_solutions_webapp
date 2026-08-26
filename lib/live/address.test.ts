import { describe, expect, it } from "vitest";

import { addressKey, buildingKey } from "@/lib/live/address";

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

  it("matches a street-only address against a full postal one", () => {
    // The two vendors do not agree on how much address to print: one
    // ships the postal address, the other often just the street. This
    // is the case that silently failed everywhere outside the one city
    // an earlier version had hard-coded.
    expect(addressKey("1204 Glencoe St, Tampa, FL 33602")).toBe(
      addressKey("1204 Glencoe St")
    );
    expect(addressKey("88 Beale St, Memphis, TN 38103")).toBe(
      addressKey("88 Beale Street")
    );
  });

  it("works the same in any market", () => {
    // Same street and number, different cities, so the keys must not
    // collide just because the city was thrown away.
    const tampa = addressKey("1204 Glencoe St, Tampa, FL 33602");
    const boise = addressKey("1204 Glencoe St, Boise, ID 83702");
    expect(tampa).toBe(boise);
    // ...which is why the caller only ever compares within one market.
    expect(tampa).toBe("1204 glencoe st");
  });

  it("keeps a unit that sits in its own comma-separated part", () => {
    expect(addressKey("77 Park Ave, Unit 4B, Denver, CO 80202")).toBe(
      addressKey("77 Park Ave #4B")
    );
    expect(addressKey("77 Park Ave, Unit 4B, Denver, CO")).not.toBe(
      addressKey("77 Park Ave, Unit 5B, Denver, CO")
    );
  });

  it("drops a city that arrives with no state or ZIP behind it", () => {
    expect(addressKey("500 Ocean Dr, Miami Beach")).toBe(
      addressKey("500 Ocean Drive")
    );
  });
});

describe("buildingKey", () => {
  it("drops an explicit unit so a block's photo reaches its flats", () => {
    // One source lists every unit; the other photographs the building
    // once. Without this, no apartment ever gets a picture.
    expect(buildingKey("9256 7th Ave Unit 4, Jacksonville, FL 32208")).toBe(
      addressKey("9256 7th Ave, Jacksonville, FL")
    );
    expect(buildingKey("1204 Glencoe St #12B, Tampa, FL")).toBe(
      addressKey("1204 Glencoe St")
    );
    expect(buildingKey("77 Park Ave, Apt 3, Denver, CO")).toBe(
      addressKey("77 Park Ave")
    );
  });

  it("leaves a bare trailing number alone", () => {
    // "1000 Highway 41" is not unit 41 of Highway. Stripping it would
    // merge it with Highway 9 and hang one building's photo on another.
    expect(buildingKey("1000 Highway 41, Ocala, FL")).toBe(
      addressKey("1000 Highway 41, Ocala, FL")
    );
    expect(buildingKey("1000 Highway 41")).not.toBe(
      buildingKey("1000 Highway 9")
    );
  });

  it("is a no-op on an address with no unit at all", () => {
    expect(buildingKey("500 Ocean Dr, Miami Beach")).toBe(
      addressKey("500 Ocean Dr, Miami Beach")
    );
  });
});

describe("addresses that carry a building's marketing name", () => {
  it("keeps the street and drops the name", () => {
    // The photo source writes apartments as "Community | Street", and
    // the other side writes only the street. Whole complexes went
    // unmatched over this.
    expect(addressKey("5 Thousand Town | 5000 Big Island Dr")).toBe(
      addressKey("5000 Big Island Dr")
    );
    expect(
      addressKey("360 Communities at Avenues Walk | 10654 Towns Way")
    ).toBe(addressKey("10654 Towns Way"));
  });

  it("is not fooled by a name that starts with a number", () => {
    // "5 Thousand Town" passes a leading-digit test, which is exactly
    // how it got used as the street in the first place.
    expect(addressKey("5 Thousand Town | 5000 Big Island Dr")).not.toBe(
      addressKey("5 Thousand Town")
    );
  });

  it("still keys a plain address with no name attached", () => {
    expect(addressKey("6680 Bennett Creek Dr")).toBe("6680 bennett creek dr");
  });

  it("carries the unit through from the street half", () => {
    expect(addressKey("The Lofts | 900 Main St Apt 5")).toBe(
      addressKey("900 Main St Unit 5")
    );
  });
});
