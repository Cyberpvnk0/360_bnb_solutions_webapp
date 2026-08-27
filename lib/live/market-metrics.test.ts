import { describe, expect, it } from "vitest";
import type { LiveMarketMonth } from "@/lib/live/airroi";
import type { MarketMonth } from "@/lib/mock/types";

/**
 * The series-selection rule the market page runs on, pinned here so a
 * refactor cannot start splicing measured months onto seeded ones — a
 * chart would draw that join as a trend and nobody would question it.
 */
function chooseSeries(
  seeded: MarketMonth[],
  live: LiveMarketMonth[] | undefined
): { series: MarketMonth[] | LiveMarketMonth[]; measured: boolean } {
  const useLive = Boolean(live && live.length >= 2);
  return { series: useLive ? live! : seeded, measured: useLive };
}

const SEEDED: MarketMonth[] = Array.from({ length: 12 }, (_, i) => ({
  month: `2026-${String(i + 1).padStart(2, "0")}-01`,
  adr: 150,
  occupancy: 0.6,
}));

const LIVE: LiveMarketMonth[] = Array.from({ length: 12 }, (_, i) => ({
  month: `2026-${String(i + 1).padStart(2, "0")}-01`,
  adr: 212,
  occupancy: 0.33,
  revenue: 1800,
  revpar: 70,
}));

describe("monthly series selection", () => {
  it("prefers the measured history", () => {
    const { series, measured } = chooseSeries(SEEDED, LIVE);
    expect(measured).toBe(true);
    expect(series).toHaveLength(12);
    expect(series[0].adr).toBe(212);
  });

  it("keeps the seeded series when nothing came back", () => {
    expect(chooseSeries(SEEDED, []).measured).toBe(false);
    expect(chooseSeries(SEEDED, undefined).measured).toBe(false);
  });

  it("refuses a single measured month rather than drawing a line through it", () => {
    // Two points make a trend; one makes a dot the eye reads as a trend
    // anyway. The seeded twelve are more honest than a lone real month.
    expect(chooseSeries(SEEDED, LIVE.slice(0, 1)).measured).toBe(false);
  });

  it("never mixes the two", () => {
    const { series } = chooseSeries(SEEDED, LIVE);
    expect(new Set(series.map((s) => s.adr)).size).toBe(1);
  });
});
