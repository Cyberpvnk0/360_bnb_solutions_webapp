import { describe, expect, it } from "vitest";
import { isFresh, STATS_TTL_MS, STORE_TTL_MS } from "./market-store";

const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe("listings and market figures age at different rates", () => {
  it("keeps a market summary for a month", () => {
    // The one row the Deal Finder's cards ever buy: a city's average,
    // which barely moves in a month and says when it was measured.
    expect(isFresh(ago(3 * DAY), STATS_TTL_MS)).toBe(true);
    expect(isFresh(ago(6 * DAY), STATS_TTL_MS)).toBe(true);
    expect(isFresh(ago(29 * DAY), STATS_TTL_MS)).toBe(true);
  });

  it("expires listings in a day", () => {
    // A listing gone in three days is a listing somebody drives to and
    // finds leased.
    expect(isFresh(ago(2 * DAY), STORE_TTL_MS)).toBe(false);
  });

  it("keeps summaries longer than listings", () => {
    // The whole point. One TTL for both meant a market bought cheaply
    // overnight was re-bought at full price on its first page view the
    // next day — a day of measured figures, then the same bill again.
    expect(STATS_TTL_MS).toBeGreaterThan(STORE_TTL_MS);
  });

  it("still expires eventually", () => {
    // Not permanent: occupancy does drift over a season, and a figure
    // that never refreshes is a figure nobody can trust.
    expect(isFresh(ago(31 * DAY), STATS_TTL_MS)).toBe(false);
  });
});
