import { describe, expect, it } from "vitest";
import { COURSE_MARKETS, COURSE_MARKET_SLUGS } from "./course-markets";
import { MARKET_BY_SLUG } from "./markets";

describe("course markets", () => {
  it("every slug is a market this catalogue carries", () => {
    // A slug that no longer resolves would silently shrink the backfill
    // queue and nobody would notice a market had stopped being covered.
    for (const slug of COURSE_MARKET_SLUGS) {
      expect(MARKET_BY_SLUG.get(slug), slug).toBeDefined();
    }
  });

  it("has no duplicates", () => {
    expect(COURSE_MARKETS.size).toBe(COURSE_MARKET_SLUGS.length);
  });

  it("is a real subset — worth paying for first, not everything", () => {
    // The whole point is that it is smaller than the catalogue. If this
    // ever equals it, the cost argument for the flag has evaporated.
    expect(COURSE_MARKET_SLUGS.length).toBeGreaterThan(50);
    expect(COURSE_MARKET_SLUGS.length).toBeLessThan(120);
  });

  it("covers the markets the course leans on hardest", () => {
    for (const slug of ["jacksonville", "tampa", "kissimmee", "nashville", "gatlinburg", "phoenix"]) {
      expect(COURSE_MARKETS.has(slug), slug).toBe(true);
    }
  });
});
