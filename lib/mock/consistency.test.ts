import { describe, expect, it } from "vitest";
import { breakevenOccupancy, netCashFlow, revpar } from "@/lib/calc/arbitrage";
import { deriveMarketAssumptions, estimateRentFromComps } from "@/lib/calc/comps";
import { ANALYSES, ANALYSIS_BY_ID } from "./analyses";
import { DEALS } from "./deals";
import { LANDLORDS } from "./landlords";
import { MARKETS } from "./markets";
import { ACTIVITY } from "./user";

/**
 * The product promise: a user can never catch the numbers contradicting
 * themselves. These tests pin that promise across the seeded world.
 */

describe("markets", () => {
  it("has exactly 40 markets within the spec's ranges", () => {
    expect(MARKETS).toHaveLength(40);
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

describe("deals", () => {
  it("spans 25 deals whose figures match their analysis exactly", () => {
    expect(DEALS).toHaveLength(25);
    for (const d of DEALS) {
      const a = ANALYSIS_BY_ID.get(d.analysisId);
      expect(a).toBeDefined();
      if (!a) continue;
      const assumptions = deriveMarketAssumptions(a.strComps);
      const be = breakevenOccupancy(a.defaults, assumptions);
      const net = netCashFlow(a.defaults, assumptions, assumptions.marketOccupancy);
      // Same rounding the pipeline card and the analyze gauge apply.
      expect(d.breakevenOccupancy).toBeCloseTo(Math.round(be * 100) / 100, 10);
      expect(d.netCashFlow).toBe(Math.round(net));
    }
  });
});

describe("landlords", () => {
  it("has 40 private contacts with two-way deal links", () => {
    expect(LANDLORDS).toHaveLength(40);
    for (const l of LANDLORDS) {
      for (const dealId of l.dealIds) {
        const deal = DEALS.find((d) => d.id === dealId);
        expect(deal, `deal ${dealId} linked from ${l.id}`).toBeDefined();
        expect(deal?.landlordIds).toContain(l.id);
      }
    }
    for (const d of DEALS) {
      expect(d.landlordIds.length).toBeGreaterThan(0);
    }
  });
});

describe("activity feed", () => {
  it("pull events carry the same date as the analysis page they link to", () => {
    for (const ev of ACTIVITY.filter((e) => e.type === "pull")) {
      const id = ev.href?.split("/").pop();
      const analysis = id ? ANALYSIS_BY_ID.get(id) : undefined;
      expect(analysis, `analysis for ${ev.id}`).toBeDefined();
      expect(ev.at.slice(0, 10)).toBe(analysis?.createdAt);
    }
  });
});
