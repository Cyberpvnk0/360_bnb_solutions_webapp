import { describe, expect, it } from "vitest";
import { furnishedKey, FURNISHED_TTL_MS, isFresh } from "./market-store";

/**
 * The most expensive answer this product buys, kept for a week.
 *
 * A furnished market search walks four pages of a portal the supplier
 * classes as protected — premium requests at ten credits each, thirty
 * on the tier some cities need. Forty to a hundred and twenty credits
 * for one market. Before this it bought a day at best, from the
 * framework's own per-deployment cache, so ten deploys in an afternoon
 * meant paying ten times for the same city.
 */
describe("the furnished set's key", () => {
  it("keeps the furnished set and the whole set apart", () => {
    expect(furnishedKey("boston", true)).not.toBe(furnishedKey("boston", false));
  });

  it("keeps markets apart", () => {
    expect(furnishedKey("boston", true)).not.toBe(furnishedKey("jacksonville", true));
  });

  it("is stable, or the store never hits", () => {
    expect(furnishedKey("boston", true)).toBe(furnishedKey("boston", true));
  });

  it("stays inside the column's length limit", () => {
    // readKeyed drops keys of 200 characters or more; the longest
    // market slug in the catalogue must not silently stop caching.
    expect(furnishedKey("a".repeat(60), true).length).toBeLessThan(200);
  });
});

describe("a week, not a day", () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const DAY = 24 * 60 * 60 * 1000;

  it("is seven days", () => {
    expect(FURNISHED_TTL_MS).toBe(7 * DAY);
  });

  it("serves a set read yesterday", () => {
    expect(isFresh(ago(DAY), FURNISHED_TTL_MS)).toBe(true);
  });

  it("serves a set read six days ago — the whole point", () => {
    expect(isFresh(ago(6 * DAY), FURNISHED_TTL_MS)).toBe(true);
  });

  it("buys again after seven", () => {
    expect(isFresh(ago(8 * DAY), FURNISHED_TTL_MS)).toBe(false);
  });

  it("buys when there is no stamp at all", () => {
    expect(isFresh(null, FURNISHED_TTL_MS)).toBe(false);
    expect(isFresh("not a date", FURNISHED_TTL_MS)).toBe(false);
  });
});
