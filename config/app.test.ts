import { describe, expect, it } from "vitest";
import {
  annualEffectiveMonthly,
  annualSavings,
  CREDIT_PACKS,
  PACK_ORDER,
  packUnitPrice,
  TIERS,
} from "./app";

describe("pricing math", () => {
  it("annual effective monthly prices match the advertised figures", () => {
    // Two months free on annual: $170/yr, $470/yr, $970/yr.
    expect(annualEffectiveMonthly(TIERS.starter)).toBe(14.17);
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
    expect(annualSavings(TIERS.starter)).toBeCloseTo(34, 2);
    expect(annualSavings(TIERS.pro)).toBeCloseTo(94, 2);
    expect(annualSavings(TIERS.scale)).toBeCloseTo(194, 2);
  });
});

describe("top-up packs", () => {
  const paidRates = [
    TIERS.starter.priceMonthly / TIERS.starter.creditLimit,
    TIERS.pro.priceMonthly / TIERS.pro.creditLimit,
    TIERS.scale.priceMonthly / TIERS.scale.creditLimit,
  ];
  const cheapestPlanRate = Math.min(...paidRates);

  it("runs five to a hundred dollars, in the order the list shows them", () => {
    const prices = PACK_ORDER.map((id) => CREDIT_PACKS[id].price);
    expect(prices[0]).toBe(5);
    expect(prices[prices.length - 1]).toBe(100);
    for (let i = 1; i < prices.length; i += 1) expect(prices[i]).toBeGreaterThan(prices[i - 1]);
  });

  it("gives a volume discount, so a bigger pack is never the worse deal", () => {
    const unit = PACK_ORDER.map((id) => packUnitPrice(CREDIT_PACKS[id]));
    for (let i = 1; i < unit.length; i += 1) expect(unit[i]).toBeLessThanOrEqual(unit[i - 1]);
  });

  it("never beats the plan rate, so packs sell the upgrade rather than replacing it", () => {
    // Anyone buying packs every month should be strictly better off one
    // tier up. If a pack ever undercut Scale, that stops being true.
    for (const id of PACK_ORDER) {
      expect(packUnitPrice(CREDIT_PACKS[id])).toBeGreaterThan(cheapestPlanRate);
    }
  });

  it("clears its worst-case cost on every pack", () => {
    // About twenty-five cents a credit when every one is a fresh
    // purchase — a comp set or a market's first read. The thinnest
    // pack keeps three-quarters.
    for (const id of PACK_ORDER) {
      const pack = CREDIT_PACKS[id];
      const margin = (pack.price - pack.credits * 0.25) / pack.price;
      expect(margin).toBeGreaterThan(0.5);
    }
  });
});
