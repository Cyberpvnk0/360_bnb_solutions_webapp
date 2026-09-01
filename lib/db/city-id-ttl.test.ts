import { describe, expect, it } from "vitest";
import {
  CITY_ID_HIT_TTL_MS,
  CITY_ID_MISS_TTL_MS,
  cityIdTtlMs,
  isFresh,
} from "./market-store";

const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe("how long a resolved city id keeps", () => {
  it("keeps a found id for a year — their ids do not change", () => {
    expect(cityIdTtlMs({ id: 8907 })).toBe(CITY_ID_HIT_TTL_MS);
    expect(isFresh(ago(300 * DAY), cityIdTtlMs({ id: 8907 }))).toBe(true);
  });

  it("keeps a miss for a week, not a year", () => {
    // A market Redfin has never carried and one bad night at the
    // resolver look identical from here. A year of remembering the
    // second one is a filter that stays broken for a year.
    expect(cityIdTtlMs({ id: null })).toBe(CITY_ID_MISS_TTL_MS);
    expect(isFresh(ago(3 * DAY), cityIdTtlMs({ id: null }))).toBe(true);
    expect(isFresh(ago(10 * DAY), cityIdTtlMs({ id: null }))).toBe(false);
  });

  it("makes a miss expire far sooner than a hit", () => {
    // The asymmetry IS the design. One number for both is a bug in
    // whichever direction it gets flattened.
    expect(CITY_ID_MISS_TTL_MS).toBeLessThan(CITY_ID_HIT_TTL_MS);
  });

  it("treats id 0 as a real id, not as absent", () => {
    // Falsy-but-present is how a valid id gets thrown away.
    expect(cityIdTtlMs({ id: 0 })).toBe(CITY_ID_HIT_TTL_MS);
  });
});
