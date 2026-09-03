import { describe, expect, it } from "vitest";

import { priceTrend } from "@/lib/live/price-history";

const RENT = 1_500;

/** The vendor keys history by date rather than shipping an array. */
const map = (entries: Record<string, unknown>) => entries;

describe("priceTrend", () => {
  it("reads a cut out of a date-keyed history", () => {
    const t = priceTrend(
      map({
        "2026-05-01": {
          event: "Rental Listing",
          price: 1_800,
          listedDate: "2026-05-01T00:00:00.000Z",
        },
        "2026-07-01": {
          event: "Rental Listing",
          price: 1_650,
          listedDate: "2026-07-01T00:00:00.000Z",
        },
      }),
      RENT
    )!;
    expect(t.askedBefore).toBe(1_800);
    expect(t.cutBy).toBe(300);
    expect(t.timesListed).toBe(2);
    expect(t.firstListedAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("reads an array the same way", () => {
    // Their own endpoints disagree about the shape; both are the truth.
    const t = priceTrend(
      [{ event: "Rental Listing", price: 1_700, listedDate: "2026-06-01" }],
      RENT
    )!;
    expect(t.cutBy).toBe(200);
  });

  it("never turns a sale price into a rent cut", () => {
    // A $350,000 sale in the same history is a $348,500 "cut" to
    // anything that takes the maximum without looking.
    const t = priceTrend(
      map({
        "2019-03-01": { event: "Sold", price: 350_000, listedDate: "2019-03-01" },
        "2026-05-01": {
          event: "Rental Listing",
          price: 1_700,
          listedDate: "2026-05-01",
        },
      }),
      RENT
    )!;
    expect(t.askedBefore).toBe(1_700);
    expect(t.cutBy).toBe(200);
  });

  it("throws out an implausible price even when nothing says it is a sale", () => {
    // The magnitude guard has to hold on its own, so a renamed event
    // type cannot get a six-figure number onto a card.
    expect(
      priceTrend(map({ a: { price: 420_000, listedDate: "2020-01-01" } }), RENT)
    ).toBeNull();
  });

  it("reports no cut for a unit that never asked more", () => {
    const t = priceTrend(map({ a: { event: "Rental Listing", price: 1_400 } }), RENT)!;
    expect(t.cutBy).toBe(0);
    expect(t.askedBefore).toBe(1_400);
  });

  it("answers null when there is nothing to read", () => {
    expect(priceTrend(undefined, RENT)).toBeNull();
    expect(priceTrend({}, RENT)).toBeNull();
    expect(priceTrend([], RENT)).toBeNull();
    expect(priceTrend(map({ a: { event: "Rental Listing" } }), RENT)).toBeNull();
    expect(priceTrend(map({ a: { price: 1_600 } }), 0)).toBeNull();
  });

  it("survives a history full of junk", () => {
    expect(
      priceTrend([null, 4, "x", { price: "1600" }] as unknown, RENT)
    ).toBeNull();
  });
});
