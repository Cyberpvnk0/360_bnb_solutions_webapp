import { describe, expect, it } from "vitest";
import { historyKey, readMonths } from "./market-history";

const month = (over: Record<string, unknown> = {}) => ({
  month: "2025-03-01",
  adr: 210,
  occupancy: 0.62,
  revenue: 4100,
  revpar: 130,
  ...over,
});

describe("historyKey", () => {
  it("namespaces the market so it cannot collide with its stats row", () => {
    expect(historyKey("phoenix-az")).toBe("market-months:phoenix-az");
    expect(historyKey("phoenix-az")).not.toBe("market:phoenix-az");
  });
});

describe("readMonths", () => {
  it("reads the stored wrapper", () => {
    expect(readMonths({ months: [month()] })).toEqual([
      { month: "2025-03-01", adr: 210, occupancy: 0.62, revenue: 4100, revpar: 130 },
    ]);
  });

  it("reads a bare array, which is what the feed answers with", () => {
    expect(readMonths([month()])).toHaveLength(1);
  });

  it("orders oldest first whatever order it was given", () => {
    const rows = readMonths([
      month({ month: "2025-03-01" }),
      month({ month: "2025-01-01" }),
      month({ month: "2025-02-01" }),
    ]);
    expect(rows.map((r) => r.month)).toEqual([
      "2025-01-01",
      "2025-02-01",
      "2025-03-01",
    ]);
  });

  it("keeps a month that is missing revenue — it is still a month", () => {
    const [row] = readMonths([month({ revenue: null, revpar: undefined })]);
    expect(row.revenue).toBeNull();
    expect(row.revpar).toBeNull();
    expect(row.adr).toBe(210);
  });

  it("drops a month with no rate or no occupancy rather than zeroing it", () => {
    expect(readMonths([month({ adr: null })])).toEqual([]);
    expect(readMonths([month({ occupancy: undefined })])).toEqual([]);
    expect(readMonths([month({ month: 3 })])).toEqual([]);
  });

  it("drops a non-finite figure rather than drawing NaN", () => {
    expect(readMonths([month({ adr: Number.NaN })])).toEqual([]);
    const [row] = readMonths([month({ revenue: Number.POSITIVE_INFINITY })]);
    expect(row.revenue).toBeNull();
  });

  it("survives anything that is not a series at all", () => {
    for (const junk of [null, undefined, 7, "months", {}, { months: 3 }, [null, 1, "x"]]) {
      expect(readMonths(junk)).toEqual([]);
    }
  });

  it("keeps the good months out of a part-broken payload", () => {
    const rows = readMonths([month({ month: "2025-01-01" }), null, month({ adr: null }), month({ month: "2025-02-01" })]);
    expect(rows.map((r) => r.month)).toEqual(["2025-01-01", "2025-02-01"]);
  });
});
