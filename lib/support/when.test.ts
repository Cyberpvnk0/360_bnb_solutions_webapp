import { describe, expect, it } from "vitest";
import { fullWhen, timeAgo } from "./when";

const NOW = Date.parse("2026-09-14T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("how long ago", () => {
  it("rounds down through the units a queue is read in", () => {
    expect(timeAgo(ago(20_000), NOW)).toBe("just now");
    expect(timeAgo(ago(5 * 60_000), NOW)).toBe("5m ago");
    expect(timeAgo(ago(3 * 3_600_000), NOW)).toBe("3h ago");
    expect(timeAgo(ago(2 * 86_400_000), NOW)).toBe("2d ago");
  });

  it("switches to a date past a week, where 'nine days' stops helping", () => {
    expect(timeAgo(ago(9 * 86_400_000), NOW)).toMatch(/Sep 5/);
  });

  it("reads a clock that is slightly ahead as 'just now', not as the future", () => {
    expect(timeAgo(new Date(NOW + 30_000).toISOString(), NOW)).toBe("just now");
  });

  it("says nothing rather than NaN for a stamp it cannot parse", () => {
    expect(timeAgo("not a date", NOW)).toBe("—");
    expect(timeAgo("", NOW)).toBe("—");
    expect(fullWhen("not a date")).toBe("");
  });
});
