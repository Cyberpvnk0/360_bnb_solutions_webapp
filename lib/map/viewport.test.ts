import { describe, expect, it } from "vitest";
import { inBounds } from "./viewport";

describe("map viewport filtering", () => {
  const bounds = { west: -72, east: -70, south: 41, north: 43 };
  it("includes interior and boundary points", () => {
    expect(inBounds({ lat: 42, lon: -71 }, bounds)).toBe(true);
    expect(inBounds({ lat: 41, lon: -72 }, bounds)).toBe(true);
    expect(inBounds({ lat: 43, lon: -70 }, bounds)).toBe(true);
  });
  it("excludes points outside either axis", () => {
    expect(inBounds({ lat: 44, lon: -71 }, bounds)).toBe(false);
    expect(inBounds({ lat: 42, lon: -73 }, bounds)).toBe(false);
  });
  it("keeps both sides of an antimeridian viewport", () => {
    const wrapped = { west: 170, east: -170, south: -10, north: 10 };
    expect(inBounds({ lat: 0, lon: 175 }, wrapped)).toBe(true);
    expect(inBounds({ lat: 0, lon: -175 }, wrapped)).toBe(true);
    expect(inBounds({ lat: 0, lon: 0 }, wrapped)).toBe(false);
  });
});
