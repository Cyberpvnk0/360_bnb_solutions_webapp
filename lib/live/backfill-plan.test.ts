import { describe, expect, it } from "vitest";
import { batchSize, callsPerMarket, money } from "./backfill-plan";
import { catalogueRef } from "./market-live";
import { MARKETS } from "@/lib/mock/markets";
import { COURSE_MARKETS } from "@/lib/mock/course-markets";

describe("what a market costs", () => {
  it("prices the three shapes the route offers", () => {
    expect(callsPerMarket({ identity: "lookup", history: true })).toBe(3);
    expect(callsPerMarket({ identity: "lookup", history: false })).toBe(2);
    expect(callsPerMarket({ identity: "catalogue", history: false })).toBe(1);
  });

  it("never drops below the one call that is the point", () => {
    expect(callsPerMarket({ identity: "catalogue", history: false })).toBe(1);
  });

  it("puts the 75 course markets at a number somebody can decide about", () => {
    expect(money(75 * callsPerMarket({ identity: "lookup", history: true }))).toBe("$40.50");
    expect(money(75 * callsPerMarket({ identity: "lookup", history: false }))).toBe("$27.00");
    expect(money(75 * callsPerMarket({ identity: "catalogue", history: false }))).toBe("$13.50");
  });
});

describe("never start a market the budget cannot finish", () => {
  it("runs the whole ask when everything fits", () => {
    expect(batchSize({ asked: 25, pending: 70, budgetLeft: 200, perMarket: 2 })).toBe(25);
  });

  it("stops at the last market the budget covers, not partway into the next", () => {
    // 50 calls at 3 a market is sixteen and two thirds. Sixteen.
    expect(batchSize({ asked: 25, pending: 70, budgetLeft: 50, perMarket: 3 })).toBe(16);
  });

  it("never promises more markets than are pending", () => {
    expect(batchSize({ asked: 25, pending: 4, budgetLeft: 500, perMarket: 1 })).toBe(4);
  });

  it("returns zero rather than a partial market when the budget is gone", () => {
    expect(batchSize({ asked: 25, pending: 70, budgetLeft: 2, perMarket: 3 })).toBe(0);
    expect(batchSize({ asked: 25, pending: 70, budgetLeft: 0, perMarket: 1 })).toBe(0);
  });
});

describe("addressing a market by name", () => {
  it("gives every course market a country, a full state name and a city", () => {
    // The cheap path is only possible because the catalogue stores the
    // state's full name. If that ever becomes "FL", every summary
    // request built from it is wrong and this is where it shows up.
    const course = MARKETS.filter((m) => COURSE_MARKETS.has(m.slug));
    expect(course.length).toBeGreaterThan(0);
    for (const market of course) {
      const ref = catalogueRef(market);
      expect(ref.country).toBe("United States");
      expect(ref.region!.length).toBeGreaterThan(2);
      expect(ref.locality!.length).toBeGreaterThan(1);
      // No district: leaving it out is what widens the answer from the
      // ZIP the centre falls in to the whole city.
      expect(ref.district).toBeUndefined();
    }
  });
});
