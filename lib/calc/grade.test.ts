import { describe, expect, it } from "vitest";
import { dealGrade, GREAT_CUSHION_PTS } from "./grade";

describe("deal grade", () => {
  it("reads the margin of safety and nothing else", () => {
    expect(dealGrade(0.12)).toBe("great");
    expect(dealGrade(GREAT_CUSHION_PTS / 100)).toBe("great");
    expect(dealGrade(0.05)).toBe("good");
    expect(dealGrade(0)).toBe("good");
    expect(dealGrade(-0.01)).toBe("bad");
  });

  it("calls a lease that can never break even bad", () => {
    // marginOfSafety is occupancy − breakeven; an infinite breakeven
    // arrives here as −Infinity, and a NaN must not read as anything good.
    expect(dealGrade(-Infinity)).toBe("bad");
    expect(dealGrade(Number.NaN)).toBe("bad");
  });

  it("agrees with the displayed whole-point cushion at the boundary", () => {
    // 7.6 pts displays as 8 and must grade as 8, not as 7.
    expect(dealGrade(0.076)).toBe("great");
    expect(dealGrade(0.074)).toBe("good");
  });
});
