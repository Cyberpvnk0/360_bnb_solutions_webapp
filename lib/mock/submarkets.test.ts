import { describe, expect, it } from "vitest";
import { MARKETS } from "./markets";
import {
  allSubmarkets,
  submarketCountFor,
  submarketsFor,
  totalSubmarketCount,
} from "./submarkets";

describe("submarkets", () => {
  it("every market carries 15–19 submarkets, matching the analytic count", () => {
    for (const m of MARKETS) {
      const subs = submarketsFor(m);
      expect(subs.length).toBe(submarketCountFor(m.slug));
      expect(subs.length).toBeGreaterThanOrEqual(15);
      expect(subs.length).toBeLessThanOrEqual(19);
    }
  });

  it("submarket listings sum EXACTLY to the parent market's listings", () => {
    for (const m of MARKETS) {
      const subs = submarketsFor(m);
      const sum = subs.reduce((a, s) => a + s.activeListings, 0);
      expect(sum, m.slug).toBe(m.activeListings);
      for (const s of subs) {
        expect(s.activeListings).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("stores whole-point occupancy and breakeven, clamped to sane bands", () => {
    for (const s of allSubmarkets()) {
      expect(Math.round(s.occupancy * 100)).toBeCloseTo(s.occupancy * 100, 8);
      expect(Math.round(s.avgBreakeven2br * 100)).toBeCloseTo(
        s.avgBreakeven2br * 100,
        8
      );
      expect(s.occupancy).toBeGreaterThanOrEqual(0.42);
      expect(s.occupancy).toBeLessThanOrEqual(0.78);
      expect(s.adr).toBeGreaterThanOrEqual(80);
      expect(s.adr).toBeLessThanOrEqual(340);
    }
  });

  it("ids are globally unique", () => {
    const all = allSubmarkets();
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
  });

  it("the analytic total matches the materialized total", () => {
    expect(totalSubmarketCount()).toBe(allSubmarkets().length);
  });

  it("Jacksonville includes its real neighborhoods", () => {
    const jax = MARKETS.find((m) => m.slug === "jacksonville");
    expect(jax).toBeDefined();
    const names = submarketsFor(jax!).map((s) => s.name);
    expect(names).toContain("San Marco");
    expect(names).toContain("San Pablo");
    expect(names).toContain("Riverside");
  });

  it("is deterministic across calls", () => {
    const m = MARKETS[0];
    const a = submarketsFor(m);
    const b = submarketsFor(m);
    expect(b).toBe(a); // memoized, same reference
  });
});
