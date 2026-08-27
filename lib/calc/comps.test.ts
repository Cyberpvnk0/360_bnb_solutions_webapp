import { describe, expect, it } from "vitest";
import {
  revenueBasis,
  revenueQuartiles,
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


describe("revenue basis", () => {
  it("prefers what the comps actually earned", () => {
    const { values, basis } = revenueBasis([
      { adr: 126, occupancy: 0.7, annualRevenue: 38_332 },
      { adr: 101, occupancy: 0.71, annualRevenue: 30_645 },
    ]);
    expect(basis).toBe("measured");
    expect(values).toEqual([38_332, 30_645]);
  });

  it("never mixes the two bases in one distribution", () => {
    // A histogram built half from measured revenue and half from
    // rate x occupancy shows a spread in methodology as if it were a
    // spread in outcomes.
    const { values, basis } = revenueBasis([
      { adr: 126, occupancy: 0.7, annualRevenue: 38_332 },
      { adr: 100, occupancy: 0.5 },
    ]);
    expect(basis).toBe("modelled");
    expect(values).toEqual([32_193, 18_250]);
  });

  it("models when nothing is measured", () => {
    expect(revenueBasis([{ adr: 200, occupancy: 0.5 }]).basis).toBe("modelled");
  });
});

describe("revenue quartiles", () => {
  it("reports the middle half and the extremes", () => {
    const q = revenueQuartiles([4969, 8191, 11_700, 11_995, 26_435, 29_702,
      30_494, 30_645, 33_793, 35_862, 38_332, 47_034])!;
    expect(q.min).toBe(4969);
    expect(q.max).toBe(47_034);
    expect(q.p25).toBeLessThan(q.p50);
    expect(q.p50).toBeLessThan(q.p75);
    // The point of showing a band: this spread is 6x end to end.
    expect(q.max / q.min).toBeGreaterThan(5);
  });

  it("handles a single comp without dividing by zero", () => {
    const q = revenueQuartiles([20_000])!;
    expect(q.p25).toBe(20_000);
    expect(q.p75).toBe(20_000);
  });

  it("is null on an empty set", () => {
    expect(revenueQuartiles([])).toBeNull();
  });
});
