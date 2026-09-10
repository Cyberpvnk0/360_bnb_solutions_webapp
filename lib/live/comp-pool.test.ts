import { describe, expect, it } from "vitest";
import {
  calibrate,
  cityCalibration,
  mergeAnchors,
  mergePool,
  milesBetween,
  MIN_ANCHORS,
  nearbyFigures,
  poolAround,
  poolDistance,
  SET_SIZE,
  toPoolComps,
  type PoolAnchor,
  type PoolComp,
} from "./comp-pool";
import { adrFactorFor } from "@/lib/mock/markets";

const HOME = { lat: 30.33, lon: -81.7 };
/** A pool comp roughly `miles` north of home. */
const comp = (id: string, miles: number, bd: number, adr: number, occ: number, at = "2026-09-01T00:00:00Z"): PoolComp => ({
  id,
  lat: HOME.lat + miles / 69.0,
  lon: HOME.lon,
  bd,
  adr,
  occ,
  at,
});
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

describe("the comp pool", () => {
  it("keeps active listings, placed at their own coordinates or at the set's point with their distance", () => {
    const pool = toPoolComps(
      [
        { id: "a", name: "x", bedrooms: 3, bathrooms: 1, adr: 150.4, occupancy: 0.3123, distanceMiles: 1, lat: 30.3, lon: -81.7 },
        // No coordinates, but a distance from the point the set was bought around.
        { id: "b", name: "y", bedrooms: 2, bathrooms: 1, adr: 120, occupancy: 0.5, distanceMiles: 0.8 },
        { id: "c", name: "z", bedrooms: 2, bathrooms: 1, adr: 120, occupancy: 0.5, distanceMiles: 1, lat: 30.3, lon: -81.7, active: false },
      ],
      HOME,
      "2026-09-10T00:00:00Z"
    );
    expect(pool).toEqual([
      { id: "a", lat: 30.3, lon: -81.7, bd: 3, adr: 150, occ: 0.312, at: "2026-09-10T00:00:00Z" },
      { id: "b", lat: HOME.lat, lon: HOME.lon, bd: 2, adr: 120, occ: 0.5, at: "2026-09-10T00:00:00Z", dist: 0.8 },
    ]);
  });

  it("counts a listing kept at its set's point no closer than it can be", () => {
    const kept: PoolComp = { ...comp("k", 0, 2, 100, 0.5), dist: 0.8 };
    // From home itself: exactly its distance from the set's point.
    expect(poolDistance(kept, HOME)).toBeCloseTo(0.8, 2);
    // From a mile away: a mile plus its distance, never less.
    expect(poolDistance(kept, { lat: HOME.lat + 1 / 69, lon: HOME.lon })).toBeCloseTo(1.8, 1);
  });

  it("merges newest-wins, drops the stale, and holds the cap", () => {
    const old = comp("a", 1, 2, 100, 0.4, "2026-01-01T00:00:00Z");
    const kept = comp("b", 1, 2, 100, 0.4, "2026-09-01T00:00:00Z");
    const again = comp("b", 1, 2, 130, 0.5, "2026-09-09T00:00:00Z");
    const merged = mergePool([old, kept], [again], Date.parse("2026-09-10T00:00:00Z"));
    expect(merged).toEqual([again]);
  });

  it("measures distance in miles", () => {
    expect(milesBetween(HOME, comp("x", 2, 2, 100, 0.5))).toBeCloseTo(2, 1);
  });
});

describe("what the listings around a point say", () => {
  it("stands on listings of the property's own size first, rates as they are", () => {
    const pool = [
      comp("1", 0.2, 3, 150, 0.3),
      comp("2", 0.4, 3, 170, 0.32),
      // Other sizes closer in than the fourth three-bedroom: not stood on
      // while there are enough of the property's own size within reach.
      comp("3", 0.6, 4, 190, 0.28),
      comp("4", 0.7, 2, 160, 0.35),
      comp("5", 0.9, 3, 180, 0.3),
      comp("6", 0.95, 1, 90, 0.6),
      comp("7", 1.6, 3, 300, 0.4),
    ];
    const f = nearbyFigures(pool, HOME, 3);
    // Three within a mile is too few for the one-mile grain, so the
    // two-mile set: the four three-bedrooms.
    expect(f).toEqual({ adr: 200, occupancy: 0.33, comps: 4, radiusMiles: 2, sizing: "exact" });
    expect(poolAround(pool, HOME)).toMatchObject({ size: 7, within1: 6, within2: 7 });
  });

  it("stands on the one-mile subset when there are enough of this size in it", () => {
    const near = [140, 150, 160, 170, 180, 190].map((adr, i) => comp(`n${i}`, 0.1 + i * 0.1, 2, adr, 0.5));
    const pool = [...near, comp("far1", 1.5, 2, 400, 0.9), comp("far2", 1.8, 2, 400, 0.9)];
    expect(nearbyFigures(pool, HOME, 2)).toEqual({
      adr: 165,
      occupancy: 0.5,
      comps: 6,
      radiusMiles: 1,
      sizing: "exact",
    });
  });

  it("brings listings within a bedroom of the property to its size when its own are too few", () => {
    const pool = [
      comp("1", 0.3, 4, 220, 0.4),
      comp("2", 0.5, 4, 240, 0.4),
      comp("3", 0.6, 3, 180, 0.4),
      comp("4", 0.8, 3, 170, 0.4),
      comp("5", 0.9, 5, 300, 0.4),
      // Two bedrooms off: not within a bedroom, left out of this tier.
      comp("6", 0.2, 2, 120, 0.9),
    ];
    const f = nearbyFigures(pool, HOME, 4);
    const to4 = (bd: number, adr: number) => adr * (adrFactorFor(4) / adrFactorFor(bd));
    expect(f).toEqual({
      adr: Math.round(mean([to4(4, 220), to4(4, 240), to4(3, 180), to4(3, 170), to4(5, 300)])),
      occupancy: 0.4,
      comps: 5,
      radiusMiles: 2,
      sizing: "close",
    });
  });

  it("scales any size within reach when nothing near the property's size is", () => {
    const pool = [comp("1", 1.1, 3, 200, 0.5), comp("2", 1.4, 3, 220, 0.5), comp("3", 1.7, 4, 260, 0.5), comp("4", 1.9, 3, 210, 0.5)];
    const f = nearbyFigures(pool, HOME, 1);
    const to1 = (bd: number, adr: number) => adr * (adrFactorFor(1) / adrFactorFor(bd));
    expect(f).toEqual({
      adr: Math.round(mean([to1(3, 200), to1(3, 220), to1(4, 260), to1(3, 210)])),
      occupancy: 0.5,
      comps: 4,
      radiusMiles: 2,
      sizing: "scaled",
    });
  });

  it("takes the nearest couple of dozen, never the whole pool around the point", () => {
    const pool = Array.from({ length: 40 }, (_, i) => comp(`c${i}`, 1.2 + i * 0.015, 2, 100 + i, 0.5));
    const f = nearbyFigures(pool, HOME, 2);
    expect(f).toMatchObject({ comps: SET_SIZE, radiusMiles: 2, sizing: "exact" });
    // The nearest twenty-five: the cheapest, as the fixture is built.
    expect(f!.adr).toBe(Math.round(mean(Array.from({ length: SET_SIZE }, (_, i) => 100 + i))));
  });

  it("says nothing when too few listings sit within two miles", () => {
    expect(nearbyFigures([comp("1", 1, 2, 100, 0.5), comp("2", 3, 2, 100, 0.5), comp("3", 1.5, 2, 100, 0.5)], HOME, 2)).toBeNull();
    expect(nearbyFigures([], HOME, 2)).toBeNull();
  });
});

describe("what the market's analyses say about its average", () => {
  const anchor = (i: number, adr: number, occ: number, at = "2026-09-01T00:00:00Z", bd = 2): PoolAnchor => ({
    lat: HOME.lat + i / 100,
    lon: HOME.lon,
    bd,
    adr,
    occ,
    at,
  });
  const CITY = { adr: 200, occupancy: 0.5, scope: "city" as const, area: "Jacksonville", at: null };

  it("keeps one anchor per point and size, the newest, and drops the old", () => {
    const stale = anchor(0, 100, 0.5, "2025-01-01T00:00:00Z");
    const first = anchor(1, 100, 0.5, "2026-08-01T00:00:00Z");
    const again = anchor(1, 120, 0.6, "2026-09-01T00:00:00Z");
    expect(mergeAnchors([stale, first], [again], Date.parse("2026-09-10T00:00:00Z"))).toEqual([again]);
  });

  it("corrects the city's figures by the median of what analyses stood on, once there are enough", () => {
    // Two-bedroom anchors, so the size factor is one and the ratios
    // read straight off: rates 1.1, 1.2, 1.2, 1.3, 1.5 of the city's,
    // occupancies 1.0, 1.1, 1.2, 1.4, 1.6 of it.
    const anchors = [
      anchor(0, 220, 0.5),
      anchor(1, 240, 0.55),
      anchor(2, 240, 0.6),
      anchor(3, 260, 0.7),
      anchor(4, 300, 0.8),
    ];
    expect(anchors).toHaveLength(MIN_ANCHORS);
    expect(adrFactorFor(2)).toBe(1);
    const cal = cityCalibration(anchors, CITY);
    expect(cal).toEqual({ n: 5, adr: 1.2, occupancy: 1.2 });
    expect(calibrate(CITY, cal)).toEqual({ ...CITY, adr: 240, occupancy: 0.6, calibration: cal });
    // Too few to say anything, and the figures pass through untouched.
    expect(cityCalibration(anchors.slice(0, 4), CITY)).toBeNull();
    expect(calibrate(CITY, null)).toEqual({ ...CITY, calibration: null });
  });

  it("reads a larger size against the city's rate scaled to that size, and never rewrites the city", () => {
    const four = Array.from({ length: 5 }, (_, i) =>
      anchor(i, Math.round(200 * adrFactorFor(4) * 1.1), 0.5, "2026-09-01T00:00:00Z", 4)
    );
    expect(cityCalibration(four, CITY)?.adr).toBeCloseTo(1.1, 1);
    const wild = Array.from({ length: 5 }, (_, i) => anchor(i, 5000, 1));
    expect(cityCalibration(wild, CITY)).toEqual({ n: 5, adr: 2, occupancy: 2 });
    expect(calibrate(CITY, cityCalibration(wild, CITY)).occupancy).toBe(1);
  });
});
