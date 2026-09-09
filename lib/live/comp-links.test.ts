import { describe, expect, it } from "vitest";
import { compListingUrl } from "./comp-links";

const EXACT = "1482756537092586123";
const ROUNDED = "1482756537092586000";

describe("where a comp can be opened", () => {
  it("uses the link the mapper gave it", () => {
    const url = `https://www.airbnb.com/rooms/${EXACT}`;
    expect(compListingUrl({ id: `sc-live-${EXACT}`, listingUrl: url })).toBe(url);
  });

  it("derives the room page from a stored comp's id when it has no link", () => {
    expect(compListingUrl({ id: "sc-live-41234567" })).toBe(
      "https://www.airbnb.com/rooms/41234567"
    );
    expect(compListingUrl({ id: `sc-live-${EXACT}` })).toBe(
      `https://www.airbnb.com/rooms/${EXACT}`
    );
  });

  it("never links from a rounded id, stored link or not", () => {
    // Both are what a comp set bought before the parser kept big ids
    // exact looks like in the store. The card falls back to the area.
    expect(
      compListingUrl({ id: `sc-live-${ROUNDED}`, listingUrl: `https://www.airbnb.com/rooms/${ROUNDED}` })
    ).toBeNull();
    expect(compListingUrl({ id: `sc-live-${ROUNDED}` })).toBeNull();
  });

  it("has nothing for a seeded comp", () => {
    expect(compListingUrl({ id: "sc-7" })).toBeNull();
  });
});
