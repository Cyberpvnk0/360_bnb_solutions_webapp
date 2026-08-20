import { describe, expect, it } from "vitest";
import { annualEffectiveMonthly, annualSavings, TIERS } from "./app";

describe("pricing math", () => {
  it("annual effective monthly prices match the advertised figures", () => {
    expect(annualEffectiveMonthly(TIERS.starter)).toBe(8.33);
    expect(annualEffectiveMonthly(TIERS.pro)).toBe(25.0);
    expect(annualEffectiveMonthly(TIERS.scale)).toBe(66.66);
  });

  it("annual is effectively two months free (within a dollar)", () => {
    for (const tier of [TIERS.starter, TIERS.pro, TIERS.scale]) {
      const tenMonths = tier.priceMonthly * 10;
      expect(Math.abs(tier.priceAnnual - tenMonths)).toBeLessThan(1);
    }
  });

  it("yearly savings are positive on every paid tier", () => {
    expect(annualSavings(TIERS.starter)).toBeCloseTo(19.67, 2);
    expect(annualSavings(TIERS.pro)).toBeCloseTo(59.67, 2);
    expect(annualSavings(TIERS.scale)).toBeCloseTo(159.67, 2);
  });
});
