import { describe, expect, it } from "vitest";
import { annualEffectiveMonthly, annualSavings, TIERS } from "./app";

describe("pricing math", () => {
  it("annual effective monthly prices match the advertised figures", () => {
    // Two months free on annual: $199.70/yr, $470/yr, $970/yr.
    expect(annualEffectiveMonthly(TIERS.starter)).toBe(16.64);
    expect(annualEffectiveMonthly(TIERS.pro)).toBe(39.17);
    expect(annualEffectiveMonthly(TIERS.scale)).toBe(80.83);
  });

  it("annual is effectively two months free (within a dollar)", () => {
    for (const tier of [TIERS.starter, TIERS.pro, TIERS.scale]) {
      const tenMonths = tier.priceMonthly * 10;
      expect(Math.abs(tier.priceAnnual - tenMonths)).toBeLessThan(1);
    }
  });

  it("yearly savings are positive on every paid tier", () => {
    expect(annualSavings(TIERS.starter)).toBeCloseTo(39.94, 2);
    expect(annualSavings(TIERS.pro)).toBeCloseTo(94, 2);
    expect(annualSavings(TIERS.scale)).toBeCloseTo(194, 2);
  });
});
