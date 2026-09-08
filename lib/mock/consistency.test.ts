import { describe, expect, it } from "vitest";
import { revpar } from "@/lib/calc/arbitrage";
import { estimateRentFromComps } from "@/lib/calc/comps";
import { ANALYSES } from "./analyses";
import { MARKETS } from "./markets";

/**
 * The product promise: a user can never catch the numbers contradicting
 * themselves. These tests pin that promise across the seeded world.
 */

describe("markets", () => {
  it("has exactly 409 markets within the spec's ranges", () => {
    expect(MARKETS).toHaveLength(409);
    for (const m of MARKETS) {
      expect(m.occupancy).toBeGreaterThanOrEqual(0.45);
      expect(m.occupancy).toBeLessThanOrEqual(0.72);
      expect(m.adr).toBeGreaterThanOrEqual(95);
      expect(m.adr).toBeLessThanOrEqual(310);
    }
  });

  it("stores breakeven at whole-point precision so displays can't drift", () => {
    for (const m of MARKETS) {
      expect(Math.round(m.avgBreakeven2br * 100)).toBeCloseTo(
        m.avgBreakeven2br * 100,
        8
      );
      expect(Math.round(m.occupancy * 100)).toBeCloseTo(m.occupancy * 100, 8);
    }
  });

  it("margin of safety equals the displayed occupancy minus displayed breakeven", () => {
    for (const m of MARKETS) {
      const displayedOcc = Math.round(m.occupancy * 100);
      const displayedBe = Math.round(m.avgBreakeven2br * 100);
      const displayedMargin = Math.round(
        (m.occupancy - m.avgBreakeven2br) * 100
      );
      expect(displayedMargin).toBe(displayedOcc - displayedBe);
    }
  });

  it("never stores RevPAR — the identity holds when computed", () => {
    for (const m of MARKETS) {
      expect(revpar(m.adr, m.occupancy)).toBeCloseTo(m.adr * m.occupancy, 10);
    }
  });

  it("slugs are globally unique so every market routes cleanly", () => {
    const slugs = new Set(MARKETS.map((m) => m.slug));
    expect(slugs.size).toBe(MARKETS.length);
  });
});

describe("analyses", () => {
  it("derives the default rent from the LTR comps shown on screen", () => {
    for (const a of ANALYSES) {
      expect(a.defaults.monthlyRent).toBe(estimateRentFromComps(a.ltrComps));
    }
  });

  it("keeps every comp within plausible bands", () => {
    for (const a of ANALYSES) {
      expect(a.strComps.length).toBeGreaterThanOrEqual(8);
      for (const c of a.strComps) {
        expect(c.occupancy).toBeGreaterThanOrEqual(0.4);
        expect(c.occupancy).toBeLessThanOrEqual(0.8);
        expect(c.adr).toBeGreaterThan(40);
      }
    }
  });
});
