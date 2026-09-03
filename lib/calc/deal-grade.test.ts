import { describe, expect, it } from "vitest";

import { gradeDeal } from "@/lib/calc/deal-grade";

describe("gradeDeal", () => {
  it("calls a lease that cannot clear breakeven what it is", () => {
    expect(gradeDeal(-6)).toMatchObject({
      grade: "bad",
      label: "Bad deal",
      why: "6 pts short of breakeven",
    });
  });

  it("does not call barely clearing breakeven a good deal", () => {
    // One point of cushion is one soft month from costing money.
    expect(gradeDeal(1).grade).toBe("fair");
    expect(gradeDeal(7).grade).toBe("fair");
  });

  it("grades on the boundaries the way the labels read", () => {
    expect(gradeDeal(0).grade).toBe("fair");
    expect(gradeDeal(8).grade).toBe("good");
    expect(gradeDeal(19).grade).toBe("good");
    expect(gradeDeal(20).grade).toBe("amazing");
  });

  it("always says the number behind the word", () => {
    // A grade with no figure under it is an opinion, and this product
    // does not have opinions about somebody else's money.
    for (const pts of [-30, -1, 0, 9, 25]) {
      expect(gradeDeal(pts).why).toMatch(/\d+ pts/);
    }
  });

  it("rounds once, so the badge and its reason cannot disagree", () => {
    expect(gradeDeal(7.6)).toMatchObject({ grade: "good", why: "8 pts of cushion" });
    expect(gradeDeal(-0.4)).toMatchObject({ grade: "fair", why: "0 pts of cushion" });
  });
});
