import { describe, expect, it } from "vitest";
import {
  COMPS_RADIUS_MAX_MILES,
  COMPS_RADIUS_PREFERRED_MILES,
  MIN_COMPS,
  NEARBY_MIN_COMPS,
  selectNearbyComps,
} from "./comps";

const at = (miles: number[]) => miles.map((distanceMiles, i) => ({ id: i, distanceMiles }));

describe("which comps a projection stands on", () => {
  it("stands on the one-mile set when there are enough in it", () => {
    const set = at([0.2, 0.4, 0.5, 0.7, 0.9, 1.0, 1.4, 1.8, 3.2]);
    const picked = selectNearbyComps(set);
    expect(picked.radiusMiles).toBe(COMPS_RADIUS_PREFERRED_MILES);
    expect(picked.comps).toHaveLength(NEARBY_MIN_COMPS);
    expect(picked.comps.every((c) => c.distanceMiles <= 1)).toBe(true);
  });

  it("widens to two miles when a mile holds too few, and never past two", () => {
    const set = at([0.5, 1.2, 1.6, 1.9, 2.0, 2.4, 6.0]);
    const picked = selectNearbyComps(set);
    expect(picked.radiusMiles).toBe(COMPS_RADIUS_MAX_MILES);
    expect(picked.comps).toHaveLength(5);
    expect(picked.comps.every((c) => c.distanceMiles <= 2)).toBe(true);
  });

  it("hands back a thin set rather than reaching further", () => {
    const set = at([1, 3, 6, 8, 12]);
    const picked = selectNearbyComps(set);
    expect(picked.radiusMiles).toBe(COMPS_RADIUS_MAX_MILES);
    expect(picked.comps).toHaveLength(1);
    expect(picked.comps.length).toBeLessThan(MIN_COMPS);
  });
});
