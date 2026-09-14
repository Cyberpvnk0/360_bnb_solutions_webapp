import { describe, expect, it } from "vitest";
import { FINE_POINTER, actionLabel, verbFor } from "./pointer";

describe("verbFor", () => {
  it("names the gesture the reader actually has", () => {
    expect(verbFor(true)).toBe("Click");
    expect(verbFor(false)).toBe("Tap");
  });
});

describe("actionLabel", () => {
  it("reads as an instruction either way", () => {
    expect(actionLabel(true, "Analyze")).toBe("Click to Analyze");
    expect(actionLabel(false, "Analyze")).toBe("Tap to Analyze");
    expect(actionLabel(false, "Measure")).toBe("Tap to Measure");
  });
});

describe("FINE_POINTER", () => {
  it("asks about the pointer, never the width", () => {
    // A width breakpoint gets a touchscreen laptop and a narrow desktop
    // window exactly backwards, which is the bug this replaced.
    expect(FINE_POINTER).not.toMatch(/width/);
    expect(FINE_POINTER).toContain("pointer");
    expect(FINE_POINTER).toContain("hover");
  });

  it("uses any-hover, so a laptop with a touchscreen still counts", () => {
    expect(FINE_POINTER).toContain("any-hover");
    expect(FINE_POINTER).toContain("any-pointer");
  });
});
