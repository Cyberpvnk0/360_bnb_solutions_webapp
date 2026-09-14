import { describe, expect, it } from "vitest";
import {
  MIN_SIDE,
  UBIQUITY,
  bandLabel,
  readAmenities,
  type AmenityComp,
} from "./amenities";

/** n listings of one size, all at one rate, all carrying `am`. */
const make = (n: number, bd: number, adr: number, am: string[]): AmenityComp[] =>
  Array.from({ length: n }, () => ({ bd, adr, occ: 0.6, am }));

describe("readAmenities", () => {
  it("finds the gap between listings with a thing and without it", () => {
    const reading = readAmenities([
      ...make(8, 2, 300, ["hot tub", "wifi"]),
      ...make(8, 2, 200, ["wifi"]),
    ])!;
    expect(reading.bedrooms).toBe(2);
    expect(reading.sample).toBe(16);
    const hot = reading.rows.find((r) => r.amenity === "hot tub")!;
    expect(hot.withCount).toBe(8);
    expect(hot.withoutCount).toBe(8);
    // 300 against 200 at the same occupancy is half as much again.
    expect(hot.lift).toBeCloseTo(0.5, 2);
  });

  it("drops a thing nearly every listing has — that is not a decision", () => {
    const reading = readAmenities([
      ...make(8, 2, 300, ["hot tub", "wifi"]),
      ...make(8, 2, 200, ["wifi"]),
    ])!;
    expect(reading.rows.map((r) => r.amenity)).not.toContain("wifi");
    expect(UBIQUITY).toBeLessThan(1);
  });

  it("refuses a comparison with too few listings on either side", () => {
    // Plenty overall, but only four carry the hot tub.
    const reading = readAmenities([
      ...make(4, 2, 300, ["hot tub", "tv"]),
      ...make(12, 2, 200, ["tv"]),
    ]);
    expect(reading?.rows.some((r) => r.amenity === "hot tub") ?? false).toBe(false);
  });

  it("compares inside one bedroom band, so size cannot pose as the amenity", () => {
    // Every pool is on a 4-bed and every 4-bed earns more. Compared
    // across bands this reads as a huge pool premium; compared inside
    // one band there is nothing to say, and nothing is what it says.
    const reading = readAmenities([
      ...make(10, 4, 600, ["pool", "tv"]),
      ...make(10, 1, 150, ["tv"]),
    ]);
    expect(reading?.rows.some((r) => r.amenity === "pool") ?? false).toBe(false);
  });

  it("picks the band with the most listings that carry amenities", () => {
    const reading = readAmenities([
      ...make(20, 3, 300, ["hot tub"]),
      ...make(20, 3, 200, ["tv"]),
      ...make(6, 1, 100, ["hot tub"]),
    ])!;
    expect(reading.bedrooms).toBe(3);
  });

  it("never counts a comp bought before amenities were read as a 'without'", () => {
    // Twelve legacy comps with no list at all. If they were treated as
    // lacking the hot tub they would pull the without-median down and
    // invent a premium out of nothing.
    const legacy: AmenityComp[] = Array.from({ length: 12 }, () => ({
      bd: 2,
      adr: 50,
      occ: 0.6,
    }));
    const reading = readAmenities([
      ...make(6, 2, 300, ["hot tub", "tv"]),
      ...make(6, 2, 290, ["tv"]),
      ...legacy,
    ])!;
    expect(reading.sample).toBe(12);
    const hot = reading.rows.find((r) => r.amenity === "hot tub");
    expect(hot?.withoutCount).toBe(6);
    // Roughly level, because the two real groups are roughly level.
    expect(Math.abs(hot!.lift)).toBeLessThan(0.1);
  });

  it("orders by the size of the gap", () => {
    const reading = readAmenities([
      ...make(6, 2, 400, ["hot tub", "pool", "tv"]),
      ...make(6, 2, 300, ["pool", "tv"]),
      ...make(6, 2, 250, ["tv"]),
    ])!;
    const lifts = reading.rows.map((r) => r.lift);
    expect([...lifts].sort((a, b) => b - a)).toEqual(lifts);
  });

  it("says nothing rather than something thin", () => {
    expect(readAmenities([])).toBeNull();
    expect(readAmenities(make(MIN_SIDE * 2 - 1, 2, 300, ["hot tub"]))).toBeNull();
    // A whole band that all has the same one thing: no contrast, no row.
    expect(readAmenities(make(30, 2, 300, ["hot tub"]))).toBeNull();
  });

  it("ignores a listing with no rate or no occupancy", () => {
    const broken: AmenityComp[] = Array.from({ length: 20 }, () => ({
      bd: 2,
      adr: 0,
      occ: 0,
      am: ["hot tub"],
    }));
    expect(readAmenities(broken)).toBeNull();
  });
});

describe("bandLabel", () => {
  it("names the band the way a reader says it", () => {
    expect(bandLabel(0)).toBe("Studio");
    expect(bandLabel(1)).toBe("1 bed");
    expect(bandLabel(3)).toBe("3 bed");
  });
});
