import { describe, expect, it } from "vitest";
import {
  mergePool,
  milesBetween,
  nearbyFigures,
  poolAround,
  poolDistance,
  seedCell,
  toPoolComps,
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

  it("measures distance in miles, and files a point in a cell about a mile and a half across", () => {
    expect(milesBetween(HOME, comp("x", 2, 2, 100, 0.5))).toBeCloseTo(2, 1);
    expect(seedCell(HOME)).toBe(seedCell({ lat: HOME.lat - 0.004, lon: HOME.lon + 0.004 }));
    expect(seedCell(HOME)).not.toBe(seedCell({ lat: HOME.lat + 0.05, lon: HOME.lon }));
  });
});

describe("what the listings around a point say", () => {
  it("stands on the one-mile set, rating from listings of about this size", () => {
    const pool = [
      comp("1", 0.2, 3, 150, 0.3),
      comp("2", 0.4, 3, 170, 0.32),
      comp("3", 0.6, 4, 190, 0.28),
      comp("4", 0.7, 2, 160, 0.35),
      comp("5", 0.9, 3, 180, 0.3),
      comp("6", 0.95, 1, 90, 0.6),
      comp("7", 1.6, 3, 300, 0.9),
    ];
    const f = nearbyFigures(pool, HOME, 3);
    expect(f).toMatchObject({ comps: 6, radiusMiles: 1 });
    // Listings within a bedroom of three: the 3s, the 4 and the 2.
    expect(f!.adr).toBe(Math.round((150 + 170 + 190 + 160 + 180) / 5));
    expect(f!.occupancy).toBe(Math.round(((0.3 + 0.32 + 0.28 + 0.35 + 0.3 + 0.6) / 6) * 100) / 100);
    expect(poolAround(pool, HOME)).toMatchObject({ size: 7, within1: 6, within2: 7 });
  });

  it("widens to two miles, scaling the rate when few listings are this size", () => {
    const pool = [comp("1", 1.1, 1, 100, 0.5), comp("2", 1.4, 1, 110, 0.5), comp("3", 1.7, 1, 90, 0.5), comp("4", 1.9, 2, 120, 0.5)];
    const f = nearbyFigures(pool, HOME, 4);
    expect(f).toMatchObject({ comps: 4, radiusMiles: 2, occupancy: 0.5 });
    const typical = Math.round((1 + 1 + 1 + 2) / 4);
    expect(f!.adr).toBe(Math.round(((100 + 110 + 90 + 120) / 4) * (adrFactorFor(4) / adrFactorFor(typical))));
  });

  it("says nothing when too few listings sit within two miles", () => {
    expect(nearbyFigures([comp("1", 1, 2, 100, 0.5), comp("2", 3, 2, 100, 0.5), comp("3", 1.5, 2, 100, 0.5)], HOME, 2)).toBeNull();
    expect(nearbyFigures([], HOME, 2)).toBeNull();
  });
});
