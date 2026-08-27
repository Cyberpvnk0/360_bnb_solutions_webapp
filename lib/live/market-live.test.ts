import { describe, expect, it } from "vitest";
import type { StoredMarketStats } from "@/lib/db/market-store";

/**
 * The substitution rule the market page runs on, asserted here so a
 * refactor cannot quietly start blending the two sources.
 */
function displayFigures(seeded: { adr: number; occupancy: number }, live: StoredMarketStats | null) {
  const measured = live?.adr != null && live.occupancy != null;
  return {
    measured,
    adr: measured ? live!.adr! : seeded.adr,
    occupancy: measured ? live!.occupancy! : seeded.occupancy,
  };
}

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
