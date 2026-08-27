import { describe, expect, it } from "vitest";
import { monthlyOutlook, seasonalRisk, usableWeights } from "./seasonality";
import type { DealInputs, MarketAssumptions } from "./arbitrage";

/** The weights the feed returned for Jacksonville 32202 — a March peak
 *  and a September trough, which is what that city actually does. */
const JAX = [
  0.08786842102330648, 0.09280824982083172, 0.10638257732620345,
  0.07890387709236514, 0.07796464173706194, 0.08331252230211554,
  0.08858623563571308, 0.0737013656430479, 0.06548192091640863,
  0.08116127942024035, 0.07763058505076088, 0.08619832403194479,
];

const INPUTS: DealInputs = {
  monthlyRent: 1800, utilitiesMonthly: 180, internetMonthly: 70,
  suppliesMonthly: 60, insuranceMonthly: 45, cleaningCostPerTurnover: 90,
  avgStayNights: 3.2, platformFeePct: 0.03, mgmtFeePct: 0,
  securityDeposit: 1800, furnishingBudget: 12000, firstMonthFree: false,
};
const MARKET: MarketAssumptions = { adr: 140, marketOccupancy: 0.45 };

describe("usableWeights", () => {
  it("accepts the feed's twelve fractions", () => {
    expect(usableWeights(JAX)).toHaveLength(12);
  });

  it("rejects a short year", () => {
    expect(usableWeights(JAX.slice(0, 11))).toBeNull();
  });

  it("rejects percentages — a different unit, not a rounding error", () => {
    expect(usableWeights(JAX.map((w) => w * 100))).toBeNull();
  });

  it("rejects nulls hiding among numbers", () => {
    const holed: unknown[] = [...JAX];
    holed[4] = null;
    expect(usableWeights(holed)).toBeNull();
  });

  it("tolerates rounding that does not quite reach one", () => {
    expect(usableWeights(JAX.map((w) => w * 0.995))).toHaveLength(12);
  });
});

describe("monthlyOutlook", () => {
  const months = monthlyOutlook(INPUTS, MARKET, JAX)!;

  it("indexes each month against an even twelfth", () => {
    expect(months[2].label).toBe("Mar");
    expect(months[2].index).toBeCloseTo(1.28, 1); // spring peak
    expect(months[8].index).toBeCloseTo(0.79, 1); // September trough
  });

  it("moves occupancy with the season", () => {
    expect(months[2].occupancy).toBeGreaterThan(MARKET.marketOccupancy);
    expect(months[8].occupancy).toBeLessThan(MARKET.marketOccupancy);
  });

  it("caps a peak at a full calendar and says so", () => {
    const busy = monthlyOutlook(INPUTS, { ...MARKET, marketOccupancy: 0.95 }, JAX)!;
    expect(busy[2].occupancy).toBe(1);
    expect(busy[2].capped).toBe(true);
    expect(months[2].capped).toBe(false);
  });

  it("refuses weights it cannot believe", () => {
    expect(monthlyOutlook(INPUTS, MARKET, [1, 2, 3])).toBeNull();
  });
});

describe("seasonalRisk", () => {
  it("counts a run that straddles the year end as one run", () => {
    // A December-and-January loss is one winter, not two blips, and the
    // difference is exactly what a student has to fund.
    const months = monthlyOutlook(INPUTS, MARKET, JAX)!.map((m, i) => ({
      ...m,
      net: i === 11 || i === 0 || i === 1 ? -400 : 900,
    }));
    expect(seasonalRisk(months)!.longestNegativeRun).toBe(3);
  });

  it("never reports a run longer than the year", () => {
    const months = monthlyOutlook(INPUTS, MARKET, JAX)!.map((m) => ({ ...m, net: -100 }));
    expect(seasonalRisk(months)!.longestNegativeRun).toBe(12);
  });

  it("totals the shortfall as money to find, not a negative", () => {
    const months = monthlyOutlook(INPUTS, MARKET, JAX)!.map((m, i) => ({
      ...m,
      net: i < 3 ? -500 : 800,
    }));
    expect(seasonalRisk(months)!.worstCaseDrawdown).toBe(1500);
  });

  it("names the weakest and strongest months", () => {
    const r = seasonalRisk(monthlyOutlook(INPUTS, MARKET, JAX)!)!;
    expect(r.weakest.label).toBe("Sep");
    expect(r.strongest.label).toBe("Mar");
  });
});
