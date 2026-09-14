import { describe, expect, it } from "vitest";
import {
  MIN_PACE_DAYS,
  lastYearByMonth,
  paceMonths,
  pacingKey,
  readPace,
} from "./market-pacing";
import type { LiveMarketPace } from "./airroi";

const day = (date: string, booked: number, adr: number | null = 200): LiveMarketPace => ({
  date,
  booked,
  adr,
  listings: null,
});

/** N days of one month, all at the same share. */
const month = (ym: string, n: number, booked: number, adr: number | null = 200) =>
  Array.from({ length: n }, (_, i) =>
    day(`${ym}-${String(i + 1).padStart(2, "0")}`, booked, adr)
  );

describe("pacingKey", () => {
  it("cannot collide with the market's stats row or its year", () => {
    expect(pacingKey("phoenix-az")).toBe("market-pace:phoenix-az");
    for (const other of ["market:phoenix-az", "market-months:phoenix-az"]) {
      expect(pacingKey("phoenix-az")).not.toBe(other);
    }
  });
});

describe("readPace", () => {
  it("reads the stored wrapper and a bare array alike", () => {
    expect(readPace({ days: [day("2026-10-01", 0.4)] })).toHaveLength(1);
    expect(readPace([day("2026-10-01", 0.4)])).toHaveLength(1);
  });

  it("orders by date whatever order it was given", () => {
    const rows = readPace([day("2026-10-03", 0.4), day("2026-10-01", 0.2)]);
    expect(rows.map((r) => r.date)).toEqual(["2026-10-01", "2026-10-03"]);
  });

  it("clamps a share the feed put outside 0 to 1", () => {
    expect(readPace([day("2026-10-01", 1.4)])[0].booked).toBe(1);
    expect(readPace([day("2026-10-01", -0.2)])[0].booked).toBe(0);
  });

  it("drops a row with no date, a partial date, or no share", () => {
    expect(readPace([{ date: "2026-10", booked: 0.4 }])).toEqual([]);
    expect(readPace([{ booked: 0.4 }])).toEqual([]);
    expect(readPace([{ date: "2026-10-01" }])).toEqual([]);
    expect(readPace([{ date: "2026-10-01", booked: Number.NaN }])).toEqual([]);
  });

  it("survives anything that is not a series", () => {
    for (const junk of [null, undefined, 3, "days", {}, { days: 1 }, [null, "x"]]) {
      expect(readPace(junk)).toEqual([]);
    }
  });
});

describe("paceMonths", () => {
  it("averages a month's days and counts them", () => {
    const [row] = paceMonths([
      ...month("2026-10", 10, 0.5),
      ...month("2026-10", 10, 0.7).map((d) => day(`2026-10-${d.date.slice(8)}`, 0.7)),
    ]);
    expect(row.month).toBe("2026-10-01");
    expect(row.days).toBe(20);
    expect(row.booked).toBeCloseTo(0.6, 3);
  });

  it("drops a month too thin to average rather than showing a spike", () => {
    const thin = paceMonths(month("2026-12", MIN_PACE_DAYS - 1, 0.9));
    expect(thin).toEqual([]);
    expect(paceMonths(month("2026-12", MIN_PACE_DAYS, 0.9))).toHaveLength(1);
  });

  it("orders months forward", () => {
    const rows = paceMonths([
      ...month("2027-01", 6, 0.3),
      ...month("2026-11", 6, 0.5),
      ...month("2026-12", 6, 0.4),
    ]);
    expect(rows.map((r) => r.month)).toEqual([
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
    ]);
  });

  it("averages only the days that carried a rate, and says null when none did", () => {
    const mixed = [...month("2026-10", 6, 0.5, 100), ...month("2026-10", 6, 0.5, null)];
    expect(paceMonths(mixed)[0].adr).toBe(100);
    expect(paceMonths(month("2026-10", 6, 0.5, null))[0].adr).toBeNull();
  });

  it("has nothing to say about a market with no forward rows", () => {
    expect(paceMonths([])).toEqual([]);
  });
});

describe("lastYearByMonth", () => {
  it("keys by month of year, so a trailing series lines up with a forward one", () => {
    const map = lastYearByMonth([
      { month: "2025-10-01", occupancy: 0.71 },
      { month: "2025-11-01", occupancy: 0.58 },
    ]);
    // A forward October in a different year still finds it.
    expect(map.get("10")).toBe(0.71);
    expect(map.get("11")).toBe(0.58);
    expect(map.get("03")).toBeUndefined();
  });

  it("is empty when no year has been bought", () => {
    expect(lastYearByMonth([]).size).toBe(0);
  });
});
