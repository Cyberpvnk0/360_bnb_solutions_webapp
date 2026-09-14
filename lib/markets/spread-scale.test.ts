import { describe, expect, it } from "vitest";
import {
  BAND_COLOR,
  BAND_LABEL,
  DECISIVE,
  LEVEL,
  SPREAD_BANDS,
  spreadBand,
} from "./spread-scale";

describe("spreadBand", () => {
  it("places a market either side of the lease", () => {
    expect(spreadBand(40_000)).toBe("well-ahead");
    expect(spreadBand(10_000)).toBe("ahead");
    expect(spreadBand(0)).toBe("level");
    expect(spreadBand(-10_000)).toBe("behind");
    expect(spreadBand(-40_000)).toBe("well-behind");
  });

  it("treats the arms symmetrically — the same dollars either side", () => {
    for (const d of [LEVEL, LEVEL + 1, DECISIVE - 1, DECISIVE, DECISIVE * 2]) {
      const up = SPREAD_BANDS.indexOf(spreadBand(d)!);
      const down = SPREAD_BANDS.indexOf(spreadBand(-d)!);
      // Equidistant from the middle of the five.
      expect(up - 2).toBe(2 - down);
    }
  });

  it("reads a market that merely covers its lease as level, not as profit", () => {
    expect(spreadBand(LEVEL)).toBe("level");
    expect(spreadBand(-LEVEL)).toBe("level");
    expect(spreadBand(LEVEL + 1)).toBe("ahead");
    expect(spreadBand(-LEVEL - 1)).toBe("behind");
  });

  it("gives an unmeasured market no band at all — it is a question, not a zero", () => {
    expect(spreadBand(null)).toBeNull();
    expect(spreadBand(undefined)).toBeNull();
    expect(spreadBand(Number.NaN)).toBeNull();
    expect(spreadBand(Number.POSITIVE_INFINITY)).toBeNull();
    // And null is emphatically not the same answer as zero.
    expect(spreadBand(0)).not.toBeNull();
  });

  it("names and colours every band, with a neutral in the middle", () => {
    expect(SPREAD_BANDS).toHaveLength(5);
    for (const b of SPREAD_BANDS) {
      expect(BAND_LABEL[b]).toBeTruthy();
      expect(BAND_COLOR[b]).toMatch(/^var\(--spread-/);
    }
    // Two hues around a neutral: the middle is its own token and is
    // never one of the poles.
    expect(BAND_COLOR.level).not.toBe(BAND_COLOR.ahead);
    expect(BAND_COLOR.level).not.toBe(BAND_COLOR.behind);
  });
});
