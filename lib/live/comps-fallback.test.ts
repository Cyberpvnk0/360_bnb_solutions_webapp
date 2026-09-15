import { describe, expect, it } from "vitest";
import { buildStrCompsFor } from "@/lib/mock/analyses";
import { compListingUrl } from "@/lib/live/comp-links";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

/**
 * The seeded comp set, checked for the two properties that made a
 * modelled screen look like a broken one.
 *
 * A user reported "the Airbnb comps are broken — no thumbnails, no
 * links" across three markets. They were not broken. The page had
 * fallen back to the modelled set and labelled it "Live comps", and a
 * modelled comp has no photo and no linkable id BY CONSTRUCTION. The
 * two symptoms were the fallback working exactly as designed, with the
 * one part that was supposed to say so printing the opposite.
 *
 * These tests pin the construction, so the day a seeded comp starts
 * carrying a photo or a live-shaped id, somebody has to come and read
 * this comment first.
 */
describe("a modelled comp", () => {
  const market = MARKET_BY_SLUG.get("jacksonville")!;
  const comps = buildStrCompsFor(market, 2, "test-analysis");

  it("exists at all, so the fallback has something to show", () => {
    expect(comps.length).toBeGreaterThan(0);
  });

  it("carries every figure the card prints", () => {
    for (const c of comps) {
      expect(c.adr).toBeGreaterThan(0);
      expect(c.occupancy).toBeGreaterThan(0);
      expect(c.bedrooms).toBeGreaterThanOrEqual(0);
      expect(typeof c.distanceMiles).toBe("number");
      expect(c.name.length).toBeGreaterThan(0);
    }
  });

  it("carries NO cover photo — which is why the thumbnail is a placeholder", () => {
    for (const c of comps) expect(c.photoUrl).toBeUndefined();
  });

  it("carries NO listing link, and none can be derived from its id", () => {
    for (const c of comps) {
      expect(c.listingUrl).toBeUndefined();
      // sc-<analysis>-<n>, which is deliberately not sc-live-<digits>.
      expect(compListingUrl(c)).toBeNull();
    }
  });

  it("is named from the seed vocabulary, which is how it was spotted", () => {
    // "Renovated 4BR by the Medical Center" and "Spacious 1BR on the
    // Greenway" were both reported as real listings. Both are two
    // picks from these lists with the bedroom count between them.
    const shape = /^[A-Z][a-z]+ \d+BR (near|by|in|on|close to) /;
    for (const c of comps) expect(c.name).toMatch(shape);
  });
});
