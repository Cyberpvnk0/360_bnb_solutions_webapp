import { describe, expect, it } from "vitest";
import type { Deal } from "@/lib/mock/types";
import { portfolioStats } from "./portfolio-tiles";

function deal(over: Partial<Deal> & { id: string }): Deal {
  return {
    analysisId: `a-${over.id}`,
    address: `${over.id} Main St`,
    city: "Jacksonville",
    stateCode: "FL",
    marketSlug: "jacksonville-fl",
    bedrooms: 2,
    stage: "prospecting",
    breakevenOccupancy: 0.5,
    netCashFlow: 800,
    landlordIds: [],
    notes: "",
    createdAt: "2026-08-01",
    updatedAt: "2026-08-01",
    ...over,
  };
}

/** Measured occupancy for jacksonville only; everywhere else unknown. */
const measured = (slug: string) => (slug === "jacksonville-fl" ? 0.66 : null);
const nothingMeasured = () => null;

describe("portfolio cash figures", () => {
  it("sums cash flow over live deals only", () => {
    const stats = portfolioStats(
      [
        deal({ id: "1", stage: "live", netCashFlow: 900 }),
        deal({ id: "2", stage: "live", netCashFlow: 1_100 }),
        // Not signed, so not paying anybody yet.
        deal({ id: "3", stage: "loi-sent", netCashFlow: 5_000 }),
      ],
      measured
    );
    expect(stats.liveCount).toBe(2);
    expect(stats.monthlyCashFlow).toBe(2_000);
  });

  it("counts cash without waiting on market figures", () => {
    const stats = portfolioStats(
      [deal({ id: "1", stage: "live", netCashFlow: 900 })],
      nothingMeasured
    );
    expect(stats.monthlyCashFlow).toBe(900);
    expect(stats.liveCount).toBe(1);
  });
});

describe("a deal is only graded against a measured market", () => {
  it("grades on the gap between market occupancy and breakeven", () => {
    const stats = portfolioStats(
      [deal({ id: "1", breakevenOccupancy: 0.52 })],
      measured
    );
    expect(stats.assessed).toBe(1);
    expect(stats.bestDeal?.cushionPts).toBe(14);
    expect(stats.atRisk).toHaveLength(0);
  });

  it("flags a deal whose breakeven sits above what the market runs", () => {
    const stats = portfolioStats(
      [deal({ id: "1", breakevenOccupancy: 0.72 })],
      measured
    );
    expect(stats.atRisk.map((d) => d.id)).toEqual(["1"]);
    expect(stats.bestDeal?.cushionPts).toBe(-6);
  });

  it("skips a deal whose market has never been measured", () => {
    // The whole point: an unmeasured market is not a verdict of "fine"
    // and not a verdict of "at risk". It is no verdict.
    const stats = portfolioStats(
      [deal({ id: "1", marketSlug: "augusta-ga", breakevenOccupancy: 0.9 })],
      measured
    );
    expect(stats.assessed).toBe(0);
    expect(stats.atRisk).toHaveLength(0);
    expect(stats.bestDeal).toBeNull();
  });

  it("skips a deal that never breaks even at any occupancy", () => {
    const stats = portfolioStats(
      [deal({ id: "1", breakevenOccupancy: Infinity })],
      measured
    );
    expect(stats.assessed).toBe(0);
    expect(stats.bestDeal).toBeNull();
  });

  it("assesses only the deals it can, and says how many", () => {
    const stats = portfolioStats(
      [
        deal({ id: "1", breakevenOccupancy: 0.4 }),
        deal({ id: "2", breakevenOccupancy: 0.6 }),
        deal({ id: "3", marketSlug: "augusta-ga", breakevenOccupancy: 0.4 }),
      ],
      measured
    );
    expect(stats.assessed).toBe(2);
    // The widest cushion of the two it could actually check.
    expect(stats.bestDeal?.deal.id).toBe("1");
    expect(stats.bestDeal?.cushionPts).toBe(26);
  });
});
