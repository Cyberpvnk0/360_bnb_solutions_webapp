import { describe, expect, it } from "vitest";
import { fmtDate, fmtDayMonth, fmtMonth, fmtWhen } from "./format";

describe("dates out of either shape the data carries", () => {
  it("formats a bare date as that day, in the local zone", () => {
    // Local midnight, so a date never slips a day across a time zone.
    expect(fmtDate("2026-03-14")).toBe("Mar 14, 2026");
    expect(fmtDayMonth("2026-03-14")).toBe("Mar 14");
    expect(fmtMonth("2026-03-14")).toBe("Mar 2026");
  });

  it("formats a full timestamp instead of printing Invalid Date", () => {
    // What the database writes: an instant with its zone. The old
    // formatters appended a second time to it and got nothing.
    const stamp = "2026-09-09T14:03:22.123456+00:00";
    expect(fmtDate(stamp)).toMatch(/^Sep \d{1,2}, 2026$/);
    expect(fmtDayMonth(stamp)).toMatch(/^Sep \d{1,2}$/);
    expect(fmtMonth(stamp)).toBe("Sep 2026");
    expect(fmtDate(new Date().toISOString())).not.toContain("Invalid");
  });

  it("prints a dash for a stamp that is not one", () => {
    for (const bad of ["", "garbage", "2026-13-45", "not a date"]) {
      expect(fmtDate(bad)).toBe("—");
      expect(fmtWhen(bad)).toBe("—");
    }
  });
});

describe("when something happened, said the way a person says it", () => {
  // A fixed clock: a Wednesday afternoon in the local zone.
  const now = new Date(2026, 8, 9, 15, 0, 0).getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const MIN = 60_000;
  const HOUR = 60 * MIN;

  it("counts minutes and hours within the day", () => {
    expect(fmtWhen(ago(20_000), now)).toBe("Just now");
    expect(fmtWhen(ago(12 * MIN), now)).toBe("12 min ago");
    expect(fmtWhen(ago(3 * HOUR), now)).toBe("3 hr ago");
  });

  it("says Yesterday for yesterday, then the date", () => {
    expect(fmtWhen(new Date(2026, 8, 8, 18, 0).toISOString(), now)).toBe("Yesterday");
    expect(fmtWhen(new Date(2026, 8, 1, 9, 0).toISOString(), now)).toBe("Sep 1");
  });

  it("adds the year only once it is in doubt", () => {
    expect(fmtWhen(new Date(2025, 11, 25, 9, 0).toISOString(), now)).toBe(
      "Dec 25, 2025"
    );
  });

  it("treats a stamp slightly ahead of the clock as now, not the future", () => {
    expect(fmtWhen(new Date(now + 5_000).toISOString(), now)).toBe("Just now");
  });

  it("reads a bare date too", () => {
    expect(fmtWhen("2026-09-01", now)).toBe("Sep 1");
  });
});
