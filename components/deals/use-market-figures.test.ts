import { describe, expect, it } from "vitest";
import type { CityFigures, RowFigures } from "@/app/api/market-figures/route";
import { dealFiguresFor, type FigureSet } from "./use-market-figures";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import { rentalsFor } from "@/lib/mock/rentals";

const market = MARKET_BY_SLUG.get("jacksonville")!;
const listing = rentalsFor(market)[0];
const city: CityFigures = {
  adr: 200,
  occupancy: 0.5,
  scope: "city",
  area: "Jacksonville",
  at: "2026-09-01T00:00:00Z",
  calibration: null,
  rates: { [listing.bedrooms]: 260 },
  spread: { low: 0.8, high: 1.2 },
};
const set = (
  row: RowFigures | null | undefined,
  byCity: CityFigures | null | undefined,
  pending = false
): FigureSet => ({ row: () => row, market: () => byCity, pending });

describe("the figures a row is projected from", () => {
  it("takes the city's rate for this size as already sized, so the card does not scale it again", () => {
    const { figures, pending } = dealFiguresFor(listing, market, set(null, city));
    expect(pending).toBe(false);
    expect(figures).toMatchObject({
      kind: "city",
      adr: 260,
      sized: true,
      occupancy: 0.5,
      area: market.name,
      spread: { low: 0.8, high: 1.2 },
    });
  });

  it("falls to the city's average, to be scaled, when no rate for this size came", () => {
    const { figures } = dealFiguresFor(listing, market, set(null, { ...city, rates: {} }));
    expect(figures).toMatchObject({ kind: "city", adr: 200 });
    expect(figures?.sized).toBeUndefined();
  });

  it("prefers what the row itself stands on", () => {
    const own: RowFigures = { kind: "comps", adr: 180, occupancy: 0.4, comps: 9, radiusMiles: 1, at: null };
    const figures = dealFiguresFor(listing, market, set(own, city)).figures;
    expect(figures).toMatchObject({ kind: "comps", adr: 180, comps: 9 });
    expect(figures?.spread).toBeUndefined();
    const near: RowFigures = { ...own, kind: "nearby", spread: { low: 0.85, high: 1.15 } };
    expect(dealFiguresFor(listing, market, set(near, city)).figures?.spread).toEqual({ low: 0.85, high: 1.15 });
  });

  it("is pending while an answer is on its way, and nothing once asked with nothing to be had", () => {
    expect(dealFiguresFor(listing, market, set(undefined, undefined, true))).toEqual({ figures: null, pending: true });
    expect(dealFiguresFor(listing, market, set(null, null))).toEqual({ figures: null, pending: false });
  });
});
