import { describe, expect, it } from "vitest";
import { compIdLooksRounded, looksRoundedId, urlIdLooksRounded } from "./listing-id";

/** A real new-style id, and what it becomes after a trip through a double. */
const EXACT = "1482756537092586123";
const ROUNDED = "1482756537092586000";

describe("an id that passed through a double", () => {
  it("is recognised by being the printed form of its nearest double", () => {
    expect(looksRoundedId(ROUNDED)).toBe(true);
    // Seventeen significant digits then zeros — the other shape a
    // rounded nineteen-digit id takes.
    expect(looksRoundedId(String(Number(EXACT)))).toBe(true);
  });

  it("does not flag a real id, even a nineteen-digit one", () => {
    expect(looksRoundedId(EXACT)).toBe(false);
    // Nor one that merely ends in zeros while still exact in a double.
    expect(looksRoundedId("41234500")).toBe(false);
    expect(looksRoundedId("9007199254740991")).toBe(false);
  });

  it("does not flag old-style short ids or non-numeric strings", () => {
    expect(looksRoundedId("41234567")).toBe(false);
    expect(looksRoundedId("")).toBe(false);
    expect(looksRoundedId("abc")).toBe(false);
    expect(looksRoundedId("sc-live-1")).toBe(false);
  });
});

describe("a platform page URL", () => {
  it("looks rounded when its trailing id does", () => {
    expect(urlIdLooksRounded(`https://www.airbnb.com/rooms/${ROUNDED}`)).toBe(true);
    expect(urlIdLooksRounded(`https://www.vrbo.com/${ROUNDED}?x=1`)).toBe(true);
    expect(urlIdLooksRounded(`https://www.airbnb.com/rooms/${EXACT}`)).toBe(false);
    expect(urlIdLooksRounded("https://www.airbnb.com/rooms/41234567")).toBe(false);
    expect(urlIdLooksRounded("https://example.com/no-id-here")).toBe(false);
  });
});

describe("a stored comp", () => {
  it("looks rounded through either its link or its identity", () => {
    expect(compIdLooksRounded({ id: `sc-live-${ROUNDED}` })).toBe(true);
    expect(
      compIdLooksRounded({ id: "sc-live-1", listingUrl: `https://www.airbnb.com/rooms/${ROUNDED}` })
    ).toBe(true);
    expect(compIdLooksRounded({ id: `sc-live-${EXACT}` })).toBe(false);
    expect(compIdLooksRounded({ id: "sc-live-41234567" })).toBe(false);
    expect(compIdLooksRounded({ id: "sc-7" })).toBe(false);
  });
});
