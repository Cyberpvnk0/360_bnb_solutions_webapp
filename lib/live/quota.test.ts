import { beforeEach, describe, expect, it } from "vitest";
import {
  checkLiveSearch,
  commitLiveSearch,
  DEFAULT_DAILY_LIVE_SEARCH_CAP,
  dailyCap,
  resetLiveSearchLedger,
} from "./quota";

const DAY_ONE = new Date("2026-08-24T12:00:00Z");
const DAY_TWO = new Date("2026-08-25T00:30:00Z");

describe("daily live-search cap", () => {
  beforeEach(() => {
    delete process.env.LIVE_SEARCH_DAILY_CAP;
    resetLiveSearchLedger();
  });

  it("defaults to RentCast's free tier of 50 distinct searches", () => {
    expect(dailyCap()).toBe(DEFAULT_DAILY_LIVE_SEARCH_CAP);
    expect(DEFAULT_DAILY_LIVE_SEARCH_CAP).toBe(50);
  });

  it("spends one slot per distinct area and none on repeats", () => {
    commitLiveSearch("market:jacksonville", DAY_ONE);
    const repeat = checkLiveSearch("market:jacksonville", DAY_ONE);
    expect(repeat.allowed).toBe(true);
    expect(repeat.cached).toBe(true);
    expect(repeat.remaining).toBe(49);

    commitLiveSearch("market:jacksonville", DAY_ONE); // still one area
    expect(checkLiveSearch("zip:32204", DAY_ONE).remaining).toBe(49);
  });

  it("refuses a new area once the cap is spent, but still serves cached ones", () => {
    process.env.LIVE_SEARCH_DAILY_CAP = "3";
    for (const key of ["market:a", "market:b", "market:c"]) {
      expect(checkLiveSearch(key, DAY_ONE).allowed).toBe(true);
      commitLiveSearch(key, DAY_ONE);
    }
    const blocked = checkLiveSearch("market:d", DAY_ONE);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    // An area already pulled today costs nothing, so it keeps working.
    expect(checkLiveSearch("market:a", DAY_ONE).allowed).toBe(true);
  });

  it("resets at the UTC day boundary", () => {
    process.env.LIVE_SEARCH_DAILY_CAP = "1";
    commitLiveSearch("market:a", DAY_ONE);
    expect(checkLiveSearch("market:b", DAY_ONE).allowed).toBe(false);
    expect(checkLiveSearch("market:b", DAY_TWO).allowed).toBe(true);
    expect(checkLiveSearch("market:b", DAY_TWO).remaining).toBe(1);
  });

  it("never lets a failed fetch spend a slot (check alone consumes nothing)", () => {
    checkLiveSearch("market:a", DAY_ONE);
    checkLiveSearch("market:a", DAY_ONE);
    checkLiveSearch("market:b", DAY_ONE);
    expect(checkLiveSearch("market:c", DAY_ONE).remaining).toBe(50);
  });

  it("honours an env override", () => {
    process.env.LIVE_SEARCH_DAILY_CAP = "250";
    expect(dailyCap()).toBe(250);
    process.env.LIVE_SEARCH_DAILY_CAP = "not-a-number";
    expect(dailyCap()).toBe(50);
  });
});
