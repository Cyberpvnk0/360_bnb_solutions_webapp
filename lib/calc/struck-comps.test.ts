import { describe, expect, it } from "vitest";
import { deriveMarketAssumptions } from "./comps";
import { projectDeal, type DealInputs } from "./arbitrage";

/**
 * Removing a comp re-prices the whole page.
 *
 * The analyzer lets somebody strike a comp that does not belong — a
 * mansion among bungalows, a listing across a motorway. What must
 * follow is that EVERY figure moves: the set is the market, and a
 * market the reader has edited is the one the projection has to stand
 * on. Occupancy especially, which is the quiet one — it drives
 * breakeven and the cushion, and a page that re-priced revenue while
 * holding occupancy at the old mean would be quietly inconsistent.
 *
 * components/analyze/analyze-result wires exactly this: `comps` filters
 * the struck ids, `deriveMarketAssumptions(comps)` reads ADR and
 * occupancy from what is left, and `projectDeal` runs off that.
 */
const INPUTS: DealInputs = {
  monthlyRent: 1800,
  securityDeposit: 1800,
  furnishingBudget: 6000,
  utilitiesMonthly: 210,
  internetMonthly: 70,
  cleaningCostPerTurnover: 90,
  avgStayNights: 3,
  suppliesMonthly: 40,
  insuranceMonthly: 60,
  platformFeePct: 0.15,
  mgmtFeePct: 0,
  firstMonthFree: false,
};

const COMPS = [
  { id: "a", adr: 150, occupancy: 0.6 },
  { id: "b", adr: 160, occupancy: 0.62 },
  { id: "c", adr: 170, occupancy: 0.64 },
  // The outlier somebody would strike: dearer and busier than the rest.
  { id: "d", adr: 400, occupancy: 0.9 },
];

const without = (id: string) => COMPS.filter((c) => c.id !== id);

describe("striking a comp", () => {
  it("moves the nightly rate", () => {
    expect(deriveMarketAssumptions(COMPS).adr).toBeGreaterThan(
      deriveMarketAssumptions(without("d")).adr
    );
  });

  it("moves occupancy, not only the rate", () => {
    const all = deriveMarketAssumptions(COMPS).marketOccupancy;
    const kept = deriveMarketAssumptions(without("d")).marketOccupancy;
    expect(all).toBeGreaterThan(kept);
    expect(kept).toBeCloseTo(0.62, 2);
  });

  it("re-prices the projection off the set that is left", () => {
    const all = projectDeal(INPUTS, deriveMarketAssumptions(COMPS));
    const kept = projectDeal(INPUTS, deriveMarketAssumptions(without("d")));
    expect(kept.monthlyRevenue).toBeLessThan(all.monthlyRevenue);
    expect(kept.netCashFlow).toBeLessThan(all.netCashFlow);
    expect(kept.annualProfit).toBeLessThan(all.annualProfit);
  });

  it("moves breakeven and the cushion, which ride on occupancy", () => {
    const all = projectDeal(INPUTS, deriveMarketAssumptions(COMPS));
    const kept = projectDeal(INPUTS, deriveMarketAssumptions(without("d")));
    // A cheaper set needs more nights to cover the same costs...
    expect(kept.breakevenOccupancy).toBeGreaterThan(all.breakevenOccupancy);
    // ...and books fewer of them, so the cushion narrows from both ends.
    expect(kept.marginOfSafety).toBeLessThan(all.marginOfSafety);
    // And the occupancy the page prints is the one the kept set says.
    expect(kept.marketOccupancy).toBe(
      deriveMarketAssumptions(without("d")).marketOccupancy
    );
  });

  it("striking a comp in the middle of the set barely moves anything", () => {
    const all = deriveMarketAssumptions(COMPS);
    const kept = deriveMarketAssumptions(without("b"));
    expect(Math.abs(kept.adr - all.adr)).toBeLessThan(30);
  });
});
