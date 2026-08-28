import { describe, expect, it } from "vitest";
import type { StoredMarketStats } from "@/lib/db/market-store";
import { displayFigures } from "@/lib/live/market-figures";

/**
 * The substitution rule every market surface runs on, asserted against
 * the real implementation so a refactor cannot quietly start blending
 * the two sources.
 */
const SEEDED = { adr: 139, occupancy: 0.6 };
const full: StoredMarketStats = {
  adr: 212.1, occupancy: 0.33, revpar: 69.9, revenue: 17_676,
  activeListings: 51, bookingLeadTime: 42.4, lengthOfStay: 3.2,
  fullName: "32202, Jacksonville, Florida, United States",
};

describe("measured figures replace seeded ones together", () => {
  it("uses the feed when it carries both", () => {
    const d = displayFigures(SEEDED, full);
    expect(d.measured).toBe(true);
    expect(d.adr).toBe(212.1);
    expect(d.occupancy).toBe(0.33);
  });

  it("falls back whole when either is missing", () => {
    // A real rate beside an invented occupancy reads as one measurement
    // and is two. Half a summary is no summary.
    const d = displayFigures(SEEDED, { ...full, occupancy: null });
    expect(d.measured).toBe(false);
    expect(d.adr).toBe(139);
    expect(d.occupancy).toBe(0.6);
  });

  it("falls back when there is no live row at all", () => {
    expect(displayFigures(SEEDED, null).measured).toBe(false);
  });
});

describe("RevPAR and provenance", () => {
  it("prefers the feed's own RevPAR over multiplying the summaries", () => {
    // 212.1 x 0.33 is 70.0; the feed says 69.9. Its figure is computed
    // over the nights that produced the rate, so it wins.
    expect(displayFigures(SEEDED, full).revpar).toBe(69.9);
  });

  it("multiplies when the feed left RevPAR out", () => {
    const d = displayFigures(SEEDED, { ...full, revpar: null });
    expect(d.revpar).toBeCloseTo(212.1 * 0.33, 6);
  });

  it("carries the measurement date, and never invents one", () => {
    const at = "2026-08-26T04:00:00.000Z";
    expect(displayFigures(SEEDED, full, at).asOf).toBe(at);
    // A modelled figure has no date. Giving it one would be the same
    // lie in a different font.
    expect(displayFigures(SEEDED, null, at).asOf).toBeNull();
  });
});
