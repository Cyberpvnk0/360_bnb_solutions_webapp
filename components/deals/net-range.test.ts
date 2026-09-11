import { describe, expect, it } from "vitest";
import { money, rangeText, rangeTone } from "./net-range";

describe("money", () => {
  it("uses a real minus sign, not a hyphen", () => {
    expect(money(-50)).toBe("−$50");
    expect(money(800)).toBe("$800");
    expect(money(0)).toBe("$0");
  });
});

describe("rangeText", () => {
  it("reads as a range when both ends clear", () => {
    expect(rangeText({ low: 600, high: 2800 })).toBe("$600 to $2,800");
  });

  it("floors a pessimistic end that dips under water", () => {
    // The range is a bracket around what is not known yet, and a card
    // read at a glance should not open on a minus sign.
    expect(rangeText({ low: -50, high: 800 })).toBe("$0 to $800");
  });

  it("collapses to one figure when nothing clears", () => {
    // "$0 to $0" is a range with nothing in it; the tone carries the
    // verdict instead.
    expect(rangeText({ low: -900, high: -200 })).toBe("$0");
  });

  it("never prints a minus", () => {
    for (const r of [
      { low: -50, high: 800 },
      { low: -900, high: -200 },
      { low: 0, high: 0 },
    ]) {
      expect(rangeText(r)).not.toContain("−");
      expect(rangeText(r)).not.toContain("-");
    }
  });
});

describe("rangeTone", () => {
  it("reads the TRUE range, so the floor cannot flatter a deal", () => {
    // The figure prints "$0 to $800"; this is what stops it reading as
    // a clear win.
    expect(rangeTone({ low: -50, high: 800 })).toBe("plain");
  });

  it("is gold only when the whole range clears", () => {
    expect(rangeTone({ low: 0, high: 800 })).toBe("good");
    expect(rangeTone({ low: 600, high: 2800 })).toBe("good");
  });

  it("is red when none of it does", () => {
    expect(rangeTone({ low: -900, high: -200 })).toBe("bad");
  });
});
