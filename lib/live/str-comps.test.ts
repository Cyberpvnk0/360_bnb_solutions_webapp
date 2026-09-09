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
vi.mock("@/lib/live/airroi", () => ({
  fetchEstimate: feed.fetchEstimate,
  hasAirRoiKey: () => true,
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

describe("a comp set stored before ids were kept exact", () => {
  it("is bought again, once, when its ids look rounded", async () => {
    store.readEstimate.mockResolvedValue({ estimate: { ...blank, comps: roundedSet }, ...fresh });

    const { analysis, liveComps } = await withLiveComps(ANALYSES[0], POINT);

    expect(feed.fetchEstimate).toHaveBeenCalledTimes(1);
    expect(liveComps).toBe(true);
    expect(analysis.strComps).toBe(exactSet);
    // Written back under the mark, so the next visit is a plain hit.
    expect(store.writeEstimate).toHaveBeenCalledTimes(1);
    expect(store.writeEstimate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ v: ESTIMATE_VERSION })
    );
  });

  it("is kept when its ids were never rounded", async () => {
    store.readEstimate.mockResolvedValue({ estimate: { ...blank, comps: shortIdSet }, ...fresh });

    const { analysis } = await withLiveComps(ANALYSES[0], POINT);

    expect(feed.fetchEstimate).not.toHaveBeenCalled();
    expect(analysis.strComps).toBe(shortIdSet);
  });
});

describe("a comp set stored since", () => {
  it("is kept even when its ids look rounded — the vendor sent them so", async () => {
    // Buying again would only buy the same; the links are dropped at
    // render instead.
    store.readEstimate.mockResolvedValue({
      estimate: { ...blank, v: ESTIMATE_VERSION, comps: roundedSet },
      ...fresh,
    });

    const { analysis } = await withLiveComps(ANALYSES[0], POINT);

    expect(feed.fetchEstimate).not.toHaveBeenCalled();
    expect(analysis.strComps).toBe(roundedSet);
  });
});
