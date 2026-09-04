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

describe("directionals that move around", () => {
  it("matches the same street whichever side the directional sits on", () => {
    // One live probe returned "1530 21st st w" and "92 w 55th st" from
    // the SAME feed, so this is not even a cross-vendor disagreement.
    expect(addressKey("1530 W 21st St, Jacksonville, FL")).toBe(
      addressKey("1530 21st St W")
    );
    expect(addressKey("92 W 55th St")).toBe(addressKey("92 55th St West"));
    expect(addressKey("4092 Barnes Rd S")).toBe(addressKey("4092 S Barnes Rd"));
    expect(addressKey("1204 NW 3rd St")).toBe(addressKey("1204 3rd St NW"));
  });

  it("never merges opposite sides of the same street", () => {
    // Moving the directional is fine; forgetting it would hang one
    // building's photo on another's row.
    expect(addressKey("1530 W 21st St")).not.toBe(addressKey("1530 E 21st St"));
    expect(addressKey("100 N Main St")).not.toBe(addressKey("100 S Main St"));
    expect(addressKey("100 NE Oak Ave")).not.toBe(addressKey("100 NW Oak Ave"));
  });

  it("leaves a street with no directional untouched", () => {
    expect(addressKey("3142 Mecca St")).toBe("3142 mecca st");
    expect(addressKey("5224 Bragg Rd")).toBe("5224 bragg rd");
  });

  it("does not strip a street whose whole name is a direction", () => {
    // "100 West" has nothing left to name it if the direction goes.
    expect(addressKey("100 West St")).toBeTruthy();
    expect(addressKey("100 North Ave")).toBeTruthy();
  });
});

describe("a unit whose designation is a letter", () => {
  it("never collides with a directional", () => {
    // "1000 Main St Apt N" and "1000 Main St N" are different buildings.
    // Folding the unit into the street made them one key, which puts a
    // stranger's photo on a real listing — worse than showing none.
    expect(addressKey("1000 Main St Apt N")).not.toBe(
      addressKey("1000 Main St N")
    );
    expect(addressKey("1000 Main St Unit W")).not.toBe(
      addressKey("1000 Main St W")
    );
  });

  it("still matches the same unit written either way", () => {
    expect(addressKey("1000 Main St Apt N")).toBe(addressKey("1000 Main St #N"));
    expect(addressKey("1000 Main St, Apt N, Tampa, FL")).toBe(
      addressKey("1000 Main St #n")
    );
  });

  it("keeps the building key free of the unit either way", () => {
    expect(buildingKey("1000 Main St Apt N")).toBe(buildingKey("1000 Main St"));
    expect(buildingKey("1000 Main St N")).toBe(addressKey("1000 Main St N"));
  });
});

describe("street suffixes the probe turned up", () => {
  it("matches Expressway written both ways", () => {
    // "7528 arlington expy" was sitting in a live index and could never
    // have met the longhand form.
    expect(addressKey("7528 Arlington Expressway")).toBe(
      addressKey("7528 Arlington Expy")
    );
  });

  it("handles the other common pairs", () => {
    expect(addressKey("10 Market Square")).toBe(addressKey("10 Market Sq"));
    expect(addressKey("22 Eagle Point")).toBe(addressKey("22 Eagle Pt"));
    expect(addressKey("5 Mount Vernon Rd")).toBe(addressKey("5 Mt Vernon Rd"));
  });
});

describe("saints and forts in street names", () => {
  it("matches the spelled-out and abbreviated forms", () => {
    expect(addressKey("2798 Saint Johns Ave")).toBe(
      addressKey("2798 St Johns Ave")
    );
    expect(addressKey("100 Fort Caroline Rd")).toBe(
      addressKey("100 Ft Caroline Rd")
    );
  });

  it("leaves ordinary streets alone", () => {
    // "Street" already reduces to "st"; folding saint the same way
    // must not disturb it.
    expect(addressKey("1204 Glencoe Street")).toBe("1204 glencoe st");
  });
});
