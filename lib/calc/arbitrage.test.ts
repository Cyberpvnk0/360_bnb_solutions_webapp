import { describe, expect, it } from "vitest";
import {
  NIGHTS_PER_MONTH,
  annualRevenueFromAdr,
  breakevenOccupancy,
  cashOnCashReturn,
  cleaningCosts,
  contributionPerNight,
  feeCosts,
  fixedMonthlyCosts,
  furnishingPaybackMonths,
  grossRevenue,
  marginOfSafety,
  netCashFlow,
  occupiedNights,
  projectDeal,
  revpar,
  startupCapital,
  totalMonthlyCosts,
  turnoversPerMonth,
  type DealInputs,
  type MarketAssumptions,
} from "./arbitrage";

/** A realistic 2BR deal used across most tests. */
const base: DealInputs = {
  monthlyRent: 1900,
  securityDeposit: 1900,
  furnishingBudget: 12000,
  utilitiesMonthly: 220,
  internetMonthly: 70,
  cleaningCostPerTurnover: 120,
  avgStayNights: 3,
  suppliesMonthly: 90,
  insuranceMonthly: 85,
  platformFeePct: 0.03,
  mgmtFeePct: 0,
};

const market: MarketAssumptions = { adr: 185, marketOccupancy: 0.62 };

describe("fixed and variable cost components", () => {
  it("sums the five fixed monthly costs", () => {
    expect(fixedMonthlyCosts(base)).toBe(1900 + 220 + 70 + 90 + 85);
  });

  it("computes occupied nights from a 30.4-night month", () => {
    expect(occupiedNights(0.62)).toBeCloseTo(0.62 * 30.4, 10);
  });

  it("derives turnovers from occupied nights and stay length", () => {
    const nights = occupiedNights(0.62);
    expect(turnoversPerMonth(base, 0.62)).toBeCloseTo(nights / 3, 10);
  });

  it("returns zero turnovers when stay length is zero (no divide-by-zero)", () => {
    expect(turnoversPerMonth({ ...base, avgStayNights: 0 }, 0.62)).toBe(0);
  });
});

describe("revenue model", () => {
  it("gross revenue = ADR × nights + cleaning fee × turnovers", () => {
    const nights = occupiedNights(0.62);
    const turns = turnoversPerMonth(base, 0.62);
    expect(grossRevenue(base, market, 0.62)).toBeCloseTo(
      185 * nights + 120 * turns,
      8
    );
  });

  it("fees apply to gross revenue including cleaning fees", () => {
    const gross = grossRevenue(base, market, 0.62);
    expect(feeCosts(base, market, 0.62)).toBeCloseTo(0.03 * gross, 8);
  });

  it("management fee stacks with the platform fee", () => {
    const withMgmt = { ...base, mgmtFeePct: 0.1 };
    const gross = grossRevenue(withMgmt, market, 0.62);
    expect(feeCosts(withMgmt, market, 0.62)).toBeCloseTo(0.13 * gross, 8);
  });

  it("net cash flow = gross − fees − cleaning − fixed", () => {
    const occ = 0.62;
    const expected =
      grossRevenue(base, market, occ) -
      feeCosts(base, market, occ) -
      cleaningCosts(base, occ) -
      fixedMonthlyCosts(base);
    expect(netCashFlow(base, market, occ)).toBeCloseTo(expected, 8);
    expect(totalMonthlyCosts(base, market, occ)).toBeCloseTo(
      feeCosts(base, market, occ) + cleaningCosts(base, occ) + fixedMonthlyCosts(base),
      8
    );
  });
});

describe("breakeven occupancy", () => {
  it("is the exact zero of net cash flow", () => {
    const be = breakevenOccupancy(base, market);
    expect(netCashFlow(base, market, be)).toBeCloseTo(0, 6);
  });

  it("stays the zero of net cash flow with a management fee", () => {
    const i = { ...base, mgmtFeePct: 0.12 };
    const be = breakevenOccupancy(i, market);
    expect(netCashFlow(i, market, be)).toBeCloseTo(0, 6);
  });

  it("matches the plain formula when cleaning is free and instant", () => {
    // With no cleaning cost the correction term vanishes:
    // breakeven = fixed / (ADR × 30.4 × (1 − fee))
    const i = { ...base, cleaningCostPerTurnover: 0 };
    const expected =
      fixedMonthlyCosts(i) / (market.adr * NIGHTS_PER_MONTH * (1 - 0.03));
    expect(breakevenOccupancy(i, market)).toBeCloseTo(expected, 10);
  });

  it("is higher than the plain formula because fees eat the cleaning pass-through", () => {
    const plain =
      fixedMonthlyCosts(base) / (market.adr * NIGHTS_PER_MONTH * (1 - 0.03));
    expect(breakevenOccupancy(base, market)).toBeGreaterThan(plain);
  });

  it("rises when rent rises", () => {
    const pricier = { ...base, monthlyRent: 2600 };
    expect(breakevenOccupancy(pricier, market)).toBeGreaterThan(
      breakevenOccupancy(base, market)
    );
  });

  it("falls when ADR rises", () => {
    const hotter = { adr: 240, marketOccupancy: 0.62 };
    expect(breakevenOccupancy(base, hotter)).toBeLessThan(
      breakevenOccupancy(base, market)
    );
  });

  it("returns Infinity when a night can never contribute", () => {
    expect(
      breakevenOccupancy({ ...base, platformFeePct: 1 }, market)
    ).toBe(Infinity);
  });

  it("lands in a plausible band for a realistic deal", () => {
    const be = breakevenOccupancy(base, market);
    expect(be).toBeGreaterThan(0.3);
    expect(be).toBeLessThan(0.55);
  });
});

describe("margin of safety", () => {
  it("is market occupancy minus breakeven", () => {
    expect(marginOfSafety(base, market)).toBeCloseTo(
      0.62 - breakevenOccupancy(base, market),
      10
    );
  });

  it("goes negative when costs exceed what the market can earn", () => {
    const doomed = { ...base, monthlyRent: 5200 };
    expect(marginOfSafety(doomed, market)).toBeLessThan(0);
  });
});

describe("capital and returns", () => {
  it("startup capital = deposit + furnishing + first month rent", () => {
    expect(startupCapital(base)).toBe(1900 + 12000 + 1900);
  });

  it("cash-on-cash = annual profit / startup capital", () => {
    const occ = market.marketOccupancy;
    const expected = (netCashFlow(base, market, occ) * 12) / startupCapital(base);
    expect(cashOnCashReturn(base, market, occ)).toBeCloseTo(expected, 10);
  });

  it("cash-on-cash is NaN with zero capital", () => {
    const i = { ...base, securityDeposit: 0, furnishingBudget: 0, monthlyRent: 0 };
    expect(cashOnCashReturn(i, market, 0.62)).toBeNaN();
  });

  it("furnishing payback = budget / net cash flow", () => {
    const occ = market.marketOccupancy;
    const expected = 12000 / netCashFlow(base, market, occ);
    expect(furnishingPaybackMonths(base, market, occ)).toBeCloseTo(expected, 10);
  });

  it("furnishing payback is Infinity when the deal loses money", () => {
    const doomed = { ...base, monthlyRent: 5200 };
    expect(furnishingPaybackMonths(doomed, market, 0.62)).toBe(Infinity);
  });
});

describe("projectDeal", () => {
  it("agrees with every underlying function", () => {
    const p = projectDeal(base, market);
    const occ = market.marketOccupancy;
    expect(p.breakevenOccupancy).toBeCloseTo(breakevenOccupancy(base, market), 10);
    expect(p.marginOfSafety).toBeCloseTo(marginOfSafety(base, market), 10);
    expect(p.monthlyRevenue).toBeCloseTo(grossRevenue(base, market, occ), 10);
    expect(p.monthlyCosts).toBeCloseTo(totalMonthlyCosts(base, market, occ), 10);
    expect(p.netCashFlow).toBeCloseTo(netCashFlow(base, market, occ), 10);
    expect(p.annualProfit).toBeCloseTo(p.netCashFlow * 12, 10);
    expect(p.startupCapital).toBe(startupCapital(base));
    expect(p.cashOnCash).toBeCloseTo(cashOnCashReturn(base, market, occ), 10);
  });

  it("internal identity: revenue − costs = net", () => {
    const p = projectDeal(base, market);
    expect(p.monthlyRevenue - p.monthlyCosts).toBeCloseTo(p.netCashFlow, 8);
  });
});

describe("market identities", () => {
  it("RevPAR = ADR × occupancy", () => {
    expect(revpar(185, 0.62)).toBeCloseTo(114.7, 10);
  });

  it("comp annual revenue = ADR × occupancy × 365", () => {
    expect(annualRevenueFromAdr(200, 0.6)).toBeCloseTo(43800, 10);
  });
});
