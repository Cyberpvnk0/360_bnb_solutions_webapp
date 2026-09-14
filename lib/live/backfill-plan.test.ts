import { describe, expect, it } from "vitest";
import {
  batchSize,
  callsPerMarket,
  dollarsPerCall,
  dollarsPerMarket,
  money,
} from "./backfill-plan";
import { catalogueRef } from "./market-live";
import { MARKETS } from "@/lib/mock/markets";
import { COURSE_MARKETS } from "@/lib/mock/course-markets";

describe("what a market costs", () => {
  it("counts the calls each shape the route offers actually makes", () => {
    // Four, not three: the history is occupancy AND rate, bought
    // separately because the endpoint answering both costs more.
    expect(callsPerMarket({ identity: "lookup", history: true })).toBe(4);
    expect(callsPerMarket({ identity: "lookup", history: false })).toBe(2);
    expect(callsPerMarket({ identity: "catalogue", history: false })).toBe(1);
  });

  it("never drops below the one call that is the point", () => {
    expect(callsPerMarket({ identity: "catalogue", history: false })).toBe(1);
  });

  it("prices each shape from the vendor's own table, not a flat rate", () => {
    expect(dollarsPerMarket({ identity: "lookup", history: true })).toBeCloseTo(0.31, 5);
    expect(dollarsPerMarket({ identity: "lookup", history: false })).toBeCloseTo(0.11, 5);
    expect(dollarsPerMarket({ identity: "catalogue", history: false })).toBeCloseTo(0.1, 5);
  });

  it("puts the 75 course markets at a number somebody can decide about", () => {
    const at = (shape: Parameters<typeof dollarsPerMarket>[0]) =>
      money(75 * dollarsPerMarket(shape));
    expect(at({ identity: "lookup", history: true })).toBe("$23.25");
    expect(at({ identity: "lookup", history: false })).toBe("$8.25");
    expect(at({ identity: "catalogue", history: false })).toBe("$7.50");
  });

  it("converts a raw meter count at this shape's own average", () => {
    // The meter counts calls without knowing which endpoint each was;
    // every call in one run follows one shape, so the average is the
    // honest conversion and reproduces the per-market price exactly.
    for (const shape of [
      { identity: "lookup", history: true },
      { identity: "catalogue", history: false },
    ] as const) {
      expect(dollarsPerCall(shape) * callsPerMarket(shape)).toBeCloseTo(
        dollarsPerMarket(shape),
        5
      );
    }
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
