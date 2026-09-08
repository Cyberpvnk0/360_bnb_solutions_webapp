import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DAILY_ENRICH_CAP,
  DEFAULT_DAILY_LIVE_SEARCH_CAP,
  DEFAULT_RENTCAST_MONTHLY_REQUESTS,
  checkLiveSearch,
  checkRentcastSearch,
  commitRentcastSearch,
  commitLiveSearch,
  dailyCap,
  joinCap,
  reserveEnrichments,
  reserveJoin,
  resetEnrichLedger,
  rentcastBudget,
  rentcastDailyCap,
  resetJoinLedger,
  resetLiveSearchLedger,
  resetRentcastLedger,
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

describe("reserveEnrichments", () => {
  beforeEach(() => {
    resetEnrichLedger();
    delete process.env.SCRAPERAPI_DAILY_ENRICH_CAP;
  });

  it("counts properties, because that is what this vendor bills", () => {
    process.env.SCRAPERAPI_DAILY_ENRICH_CAP = "50";
    expect(reserveEnrichments(24).granted).toBe(24);
    expect(reserveEnrichments(24).remaining).toBe(2);
  });

  it("grants a partial page rather than refusing the whole one", () => {
    process.env.SCRAPERAPI_DAILY_ENRICH_CAP = "10";
    reserveEnrichments(8);
    // Eighteen enriched rows beat zero enriched rows.
    expect(reserveEnrichments(24).granted).toBe(2);
    expect(reserveEnrichments(1).granted).toBe(0);
  });

  it("resets on the UTC day boundary", () => {
    process.env.SCRAPERAPI_DAILY_ENRICH_CAP = "5";
    const today = new Date("2026-08-24T23:59:00Z");
    const tomorrow = new Date("2026-08-25T00:01:00Z");
    expect(reserveEnrichments(5, today).remaining).toBe(0);
    expect(reserveEnrichments(5, tomorrow).granted).toBe(5);
  });

  it("falls back to the cautious default on a junk cap", () => {
    process.env.SCRAPERAPI_DAILY_ENRICH_CAP = "not-a-number";
    expect(reserveEnrichments(1).cap).toBe(DEFAULT_DAILY_ENRICH_CAP);
  });
});

describe("the listing-page join cap", () => {
  beforeEach(() => resetJoinLedger());

  it("lets a market through once and remembers it for free", () => {
    // The same market re-read in the same day is one spend, not two.
    expect(reserveJoin("tampa").allowed).toBe(true);
    const again = reserveJoin("tampa");
    expect(again.allowed).toBe(true);
    expect(again.cached).toBe(true);
  });

  it("stops at the cap and counts distinct markets", () => {
    const cap = joinCap();
    for (let i = 0; i < cap; i += 1) {
      expect(reserveJoin(`m-${i}`).allowed).toBe(true);
    }
    expect(reserveJoin("one-too-many").allowed).toBe(false);
    // A market already spent today still gets through — it costs
    // nothing, and refusing it would strand rows for no saving.
    expect(reserveJoin("m-0").allowed).toBe(true);
  });

  it("resets on the next UTC day", () => {
    const today = new Date("2026-03-01T23:59:00Z");
    const tomorrow = new Date("2026-03-02T00:01:00Z");
    for (let i = 0; i < joinCap(); i += 1) reserveJoin(`m-${i}`, today);
    expect(reserveJoin("fresh", today).allowed).toBe(false);
    expect(reserveJoin("fresh", tomorrow).allowed).toBe(true);
  });
});

describe("the rentals feed's own ledger", () => {
  beforeEach(() => resetRentcastLedger());

  it("derives a daily cap from a monthly plan, and never goes under one", () => {
    // Fifty a month is the free tier. Fifty a day was the old cap —
    // the whole month, spent by lunch.
    expect(DEFAULT_RENTCAST_MONTHLY_REQUESTS).toBe(50);
    expect(rentcastDailyCap()).toBe(1);
    expect(rentcastDailyCap()).toBeLessThan(DEFAULT_DAILY_LIVE_SEARCH_CAP);
  });

  it("is separate from the ledger the other vendors share", () => {
    // Lowering one to protect RentCast must not strangle the comps or
    // the furnished search, which answer to different plans.
    commitRentcastSearch("market:jacksonville", DAY_ONE);
    expect(checkRentcastSearch("market:tampa", DAY_ONE).allowed).toBe(false);
    expect(checkLiveSearch("str:30.33,-81.66", DAY_ONE).allowed).toBe(true);
  });

  it("serves a repeat of today's area free, and checks before it spends", () => {
    expect(checkRentcastSearch("market:jacksonville", DAY_ONE).allowed).toBe(true);
    // Nothing committed yet: a failed fetch must not cost the slot.
    expect(checkRentcastSearch("market:tampa", DAY_ONE).allowed).toBe(true);
    commitRentcastSearch("market:jacksonville", DAY_ONE);
    const repeat = checkRentcastSearch("market:jacksonville", DAY_ONE);
    expect(repeat.allowed).toBe(true);
    expect(repeat.cached).toBe(true);
    expect(checkRentcastSearch("market:tampa", DAY_ONE).allowed).toBe(false);
  });

  it("resets on the next UTC day", () => {
    commitRentcastSearch("market:a", DAY_ONE);
    expect(checkRentcastSearch("market:b", DAY_ONE).allowed).toBe(false);
    expect(checkRentcastSearch("market:b", DAY_TWO).allowed).toBe(true);
  });

  it("reports the plan it is budgeting against", () => {
    const b = rentcastBudget(DAY_ONE);
    expect(b.monthly).toBe(50);
    expect(b.cap).toBe(1);
    expect(b.remaining).toBe(1);
  });
});
