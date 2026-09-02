import { describe, expect, it } from "vitest";

import { streetPartOf } from "@/lib/live/address";

describe("streetPartOf", () => {
  it("keeps the street and drops a building's marketing name", () => {
    // Apartment rows arrive as "Community | Street". The name geocodes
    // to nothing and reads as noise on a card; the street is the
    // address.
    expect(streetPartOf("5 Thousand Town | 5000 Big Island Dr")).toBe(
      "5000 Big Island Dr"
    );
    expect(
      streetPartOf("360 Communities at Avenues Walk | 10654 Towns Way")
    ).toBe("10654 Towns Way");
  });

  it("is not fooled by a name that starts with a number", () => {
    // "5 Thousand Town" passes a leading-digit test, which is exactly
    // how it got used as the street in the first place. Both halves
    // start with a digit here; the street is the LAST one that does.
    expect(streetPartOf("5 Thousand Town | 5000 Big Island Dr")).not.toBe(
      "5 Thousand Town"
    );
  });

  it("carries the unit through from the street half", () => {
    expect(streetPartOf("The Lofts | 900 Main St Apt 5")).toBe(
      "900 Main St Apt 5"
    );
  });

  it("passes a plain address through untouched", () => {
    expect(streetPartOf("6680 Bennett Creek Dr")).toBe("6680 Bennett Creek Dr");
    expect(streetPartOf("1204 Glencoe St, Jacksonville, FL 32211")).toBe(
      "1204 Glencoe St, Jacksonville, FL 32211"
    );
  });

  it("falls back to the last part when no half starts with a digit", () => {
    // Nothing to prefer, so take what follows the name rather than
    // returning the name itself.
    expect(streetPartOf("The Lofts | Main Street Lofts")).toBe(
      "Main Street Lofts"
    );
  });

  it("trims the whitespace around the separator", () => {
    expect(streetPartOf("Riverside Flats |   400 Water St  ")).toBe(
      "400 Water St"
    );
  });
});
