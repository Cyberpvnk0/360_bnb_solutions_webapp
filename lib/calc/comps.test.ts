import { describe, expect, it } from "vitest";
import {
  compSetStrength,
  deriveMarketAssumptions,
  estimateRentFromComps,
} from "./comps";

describe("deriveMarketAssumptions", () => {
  it("averages ADR to whole dollars and occupancy to whole points", () => {
    const comps = [
      { adr: 200, occupancy: 0.6 },
      { adr: 210, occupancy: 0.62 },
      { adr: 190, occupancy: 0.64 },
    ];
    const a = deriveMarketAssumptions(comps);
    expect(a.adr).toBe(200);
    expect(a.marketOccupancy).toBeCloseTo(0.62, 10);
  });

  it("returns zeros for an empty comp set", () => {
    expect(deriveMarketAssumptions([])).toEqual({ adr: 0, marketOccupancy: 0 });
  });
});

describe("estimateRentFromComps", () => {
  it("takes the median rounded to $25", () => {
    const rents = [{ rent: 1490 }, { rent: 1720 }, { rent: 2400 }];
    expect(estimateRentFromComps(rents)).toBe(1725);
  });
});

describe("compSetStrength", () => {
  it("rates a large, tight comp set High", () => {
    const comps = Array.from({ length: 10 }, (_, i) => ({
      adr: 200 + i, // tiny spread
      occupancy: 0.6,
    }));
    expect(compSetStrength(comps)).toEqual({ score: 5, label: "High" });
  });

  it("rates a small, scattered comp set Thin", () => {
    const comps = [
      { adr: 90, occupancy: 0.5 },
      { adr: 240, occupancy: 0.6 },
      { adr: 150, occupancy: 0.7 },
    ];
    const s = compSetStrength(comps);
    expect(s.score).toBeLessThanOrEqual(2);
    expect(s.label).toBe("Thin");
  });

  it("handles an empty set", () => {
    expect(compSetStrength([])).toEqual({ score: 1, label: "Thin" });
  });
});
