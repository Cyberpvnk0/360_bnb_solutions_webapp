/**
 * The store before the wallet — and, once, the wallet again.
 *
 * A comp set stored before ids were parsed exactly holds rounded ids
 * whose links open nothing. These pin the one re-buy that fixes it and
 * the rule that stops it from becoming a re-buy on every visit.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StrComp } from "@/lib/mock/types";

const store = vi.hoisted(() => ({
  readEstimate: vi.fn(),
  writeEstimate: vi.fn(async () => ({ ok: true })),
}));
const feed = vi.hoisted(() => ({ fetchEstimate: vi.fn() }));

vi.mock("@/lib/db/market-store", () => ({
  estimateKey: (spec: Record<string, number>) => `estimate:${Object.values(spec).join(":")}`,
  isFresh: () => true,
  readEstimate: store.readEstimate,
  writeEstimate: store.writeEstimate,
}));
// Hoisted with the mock that returns it: vi.mock runs before the
// module body, so a plain class declaration here is still in its TDZ.
const { FakeAirRoiError } = vi.hoisted(() => ({
  FakeAirRoiError: class extends Error {
    constructor(
      readonly reason: string,
      readonly status?: number,
      readonly detail?: string
    ) {
      super(`AirROI ${reason}`);
      this.name = "AirRoiError";
    }
  },
}));
vi.mock("@/lib/live/airroi", () => ({
  fetchEstimate: feed.fetchEstimate,
  hasAirRoiKey: () => true,
  AirRoiError: FakeAirRoiError,
}));
vi.mock("@/lib/live/quota", () => ({
  checkLiveSearch: () => ({ allowed: true }),
  commitLiveSearch: () => undefined,
}));

import { ESTIMATE_VERSION, withLiveComps } from "./str-comps";
import { ANALYSES } from "@/lib/mock/analyses";

const ROUNDED = "1482756537092586000";
const EXACT = "1482756537092586123";
const POINT = { lat: 35.3, lon: -80.73 };

function comp(id: string, i: number): StrComp {
  return {
    id: `sc-live-${id}`,
    name: `Comp ${i}`,
    bedrooms: 2,
    bathrooms: 1,
    adr: 120 + i,
    occupancy: 0.5,
    distanceMiles: 0.5 + i / 10,
    listingUrl: `https://www.airbnb.com/rooms/${id}`,
  } as StrComp;
}
const roundedSet = Array.from({ length: 5 }, (_, i) => comp(ROUNDED, i));
const exactSet = Array.from({ length: 5 }, (_, i) => comp(EXACT, i));
const shortIdSet = Array.from({ length: 5 }, (_, i) => comp(`4123456${i}`, i));

const blank = { monthlyRevenue: null, revenue: null, adr: null, occupancy: null };
const fresh = { at: new Date().toISOString() };

beforeEach(() => {
  store.readEstimate.mockReset();
  store.writeEstimate.mockClear();
  feed.fetchEstimate.mockReset();
  feed.fetchEstimate.mockResolvedValue({ ...blank, percentiles: {}, comps: exactSet });
});

describe("a comp set stored in an older format", () => {
  it("is bought again, once — it may hold comps that are not comps any more", async () => {
    for (const older of [{}, { v: 2 }, { v: 3 }]) {
      feed.fetchEstimate.mockClear();
      store.writeEstimate.mockClear();
      store.readEstimate.mockResolvedValue({ estimate: { ...blank, ...older, comps: shortIdSet }, ...fresh });

      const { analysis, liveComps } = await withLiveComps(ANALYSES[0], POINT);

      expect(feed.fetchEstimate).toHaveBeenCalledTimes(1);
      expect(liveComps).toBe(true);
      expect(analysis.strComps).toEqual(exactSet);
      // Written back under the mark, so the next visit is a plain hit.
      expect(store.writeEstimate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ v: ESTIMATE_VERSION })
      );
    }
  });
});

describe("a comp set stored in the current format", () => {
  it("is kept even when its ids look rounded — the vendor sent them so", async () => {
    // Buying again would only buy the same; the links are dropped at
    // render instead.
    store.readEstimate.mockResolvedValue({
      estimate: { ...blank, v: ESTIMATE_VERSION, comps: roundedSet },
      ...fresh,
    });

    const { analysis } = await withLiveComps(ANALYSES[0], POINT);

    expect(feed.fetchEstimate).not.toHaveBeenCalled();
    expect(analysis.strComps).toEqual(roundedSet);
  });

  it("never shows a comp the feed marked as gone", async () => {
    const stored = [
      ...exactSet.slice(0, 3),
      { ...exactSet[3], active: false },
      { ...exactSet[4], active: false },
    ];
    store.readEstimate.mockResolvedValue({
      estimate: { ...blank, v: ESTIMATE_VERSION, comps: stored },
      ...fresh,
    });

    const { analysis } = await withLiveComps(ANALYSES[0], POINT);

    expect(feed.fetchEstimate).not.toHaveBeenCalled();
    expect(analysis.strComps).toEqual(exactSet.slice(0, 3));
  });

  /**
   * The rule this file used to enforce the other way round.
   *
   * Below four survivors, the real listings were discarded and the
   * seeded ones were shown in their place — so a property with three
   * real Airbnb comps nearby displayed nine that do not exist, with no
   * photos and no links, and every figure on the page came from them.
   * Three real listings are weaker evidence than ten and better
   * evidence than none; the screen says how many and the reader
   * weighs it.
   */
  it("SHOWS a thin set rather than replacing it with invented listings", async () => {
    const stored = [
      ...exactSet.slice(0, 3),
      { ...exactSet[3], active: false },
      { ...exactSet[4], active: false },
    ];
    store.readEstimate.mockResolvedValue({
      estimate: { ...blank, v: ESTIMATE_VERSION, comps: stored },
      ...fresh,
    });

    const { analysis, liveComps, thin } = await withLiveComps(ANALYSES[0], POINT);

    expect(liveComps).toBe(true);
    expect(thin).toBe(true);
    expect(analysis.strComps).toHaveLength(3);
    // Not the seeded set, which is what used to be returned here.
    expect(analysis.strComps).not.toBe(ANALYSES[0].strComps);
  });

  it("falls back to the modelled set only when NOTHING real is left", async () => {
    store.readEstimate.mockResolvedValue({
      estimate: {
        ...blank,
        v: ESTIMATE_VERSION,
        comps: exactSet.map((c) => ({ ...c, active: false })),
      },
      ...fresh,
    });

    const { analysis, liveComps, reason } = await withLiveComps(ANALYSES[0], POINT);

    expect(liveComps).toBe(false);
    expect(reason).toBe("thin-set");
    expect(analysis.strComps).toBe(ANALYSES[0].strComps);
  });

  it("shows a thin PURCHASE too, and still stores it so it is not bought twice", async () => {
    store.readEstimate.mockResolvedValue(null);
    feed.fetchEstimate.mockResolvedValue({ ...blank, percentiles: {}, comps: exactSet.slice(0, 2) });

    const { analysis, liveComps, thin } = await withLiveComps(ANALYSES[0], POINT);

    expect(liveComps).toBe(true);
    expect(thin).toBe(true);
    expect(analysis.strComps).toHaveLength(2);
    expect(store.writeEstimate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ v: ESTIMATE_VERSION })
    );
  });

  it("a full set is not marked thin", async () => {
    store.readEstimate.mockResolvedValue({
      estimate: { ...blank, v: ESTIMATE_VERSION, comps: exactSet },
      ...fresh,
    });

    const { liveComps, thin } = await withLiveComps(ANALYSES[0], POINT);

    expect(liveComps).toBe(true);
    expect(thin).toBe(false);
  });
});

describe("where a bought set is filed", () => {
  it("is filed under the property's address too, when the point is the property", async () => {
    store.readEstimate.mockResolvedValue(null);
    const analysis = { ...ANALYSES[0], address: "1804 E Sitka St", stateCode: "FL" };

    await withLiveComps(analysis, POINT, { atProperty: true });

    const keys = store.writeEstimate.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(keys).toHaveLength(2);
    expect(keys).toContain(
      `estimate:addr:v1:fl:1804 sitka st e:${analysis.bedrooms}:${analysis.bathrooms}`
    );
  });

  it("is filed by point alone when the point is a market's centre standing in for one", async () => {
    store.readEstimate.mockResolvedValue(null);

    await withLiveComps(ANALYSES[0], POINT);

    expect(store.writeEstimate).toHaveBeenCalledTimes(1);
  });
});

/**
 * Why the comps are modelled, said precisely.
 *
 * All five of these used to arrive at the screen as one word, from a
 * bare `catch {}` that discarded the error object — while AirRoiError
 * had been carrying the reason, the status and the service's own
 * explanation the whole time. A rejected key is an operator's
 * five-minute fix, an empty vendor account is a billing one, our own
 * brake is an environment variable, and a 502 is waiting. Telling a
 * member they are all "could not be reached" sent two rounds of
 * debugging to the wrong place.
 */
describe("when the vendor call fails", () => {
  beforeEach(() => {
    store.readEstimate.mockResolvedValue(null);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it.each([
    ["auth", "vendor-key"],
    ["quota", "vendor-quota"],
    ["budget", "vendor-budget"],
    ["no-key", "not-configured"],
    ["http", "vendor"],
    ["network", "vendor"],
  ])("reports %s as %s", async (thrown, expected) => {
    feed.fetchEstimate.mockRejectedValue(new FakeAirRoiError(thrown, 401, "nope"));

    const { liveComps, reason } = await withLiveComps(ANALYSES[0], POINT);

    expect(liveComps).toBe(false);
    expect(reason).toBe(expected);
  });

  it("still answers with the modelled set rather than failing the page", async () => {
    feed.fetchEstimate.mockRejectedValue(new FakeAirRoiError("auth", 403, "bad key"));
    const { analysis } = await withLiveComps(ANALYSES[0], POINT);
    expect(analysis.strComps).toBe(ANALYSES[0].strComps);
  });

  it("logs what the service actually said, since a status alone explains nothing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    feed.fetchEstimate.mockRejectedValue(
      new FakeAirRoiError("http", 400, "bedrooms is required")
    );
    await withLiveComps(ANALYSES[0], POINT);
    expect(logged.mock.calls.flat().join(" ")).toContain("bedrooms is required");
  });

  it("falls back to the plain word for something that is not an AirRoiError", async () => {
    feed.fetchEstimate.mockRejectedValue(new TypeError("boom"));
    const { reason } = await withLiveComps(ANALYSES[0], POINT);
    expect(reason).toBe("vendor");
  });
});
