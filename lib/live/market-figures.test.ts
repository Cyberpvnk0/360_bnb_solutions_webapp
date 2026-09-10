import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { figuresFrom, marketFigures, resetMarketFiguresMemory } from "./market-figures";
import { hasAirRoiKey } from "./airroi";
import { fetchLiveMarket } from "./market-live";
import { readMarketStatsFor, writeMarketStats } from "@/lib/db/market-store";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

vi.mock("./airroi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./airroi")>()),
  hasAirRoiKey: vi.fn(() => true),
}));
vi.mock("./market-live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./market-live")>()),
  fetchLiveMarket: vi.fn(),
}));
vi.mock("@/lib/db/market-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/market-store")>()),
  readMarketStatsFor: vi.fn(),
  writeMarketStats: vi.fn(),
}));

const summary = (adr: number, occupancy: number) => ({
  adr,
  occupancy,
  revpar: null,
  revenue: null,
  activeListings: null,
  bookingLeadTime: null,
  lengthOfStay: null,
});
const NOW = new Date().toISOString();
const LONG_AGO = "2020-01-01T00:00:00Z";
const columbus = MARKET_BY_SLUG.get("columbus")!;

const stored = vi.mocked(readMarketStatsFor);
const keep = vi.mocked(writeMarketStats);
const liveMarket = vi.mocked(fetchLiveMarket);

describe("figures out of a stored row", () => {
  it("rounds, keeps the row's own scope, and refuses a row missing either figure", () => {
    expect(figuresFrom({ ...summary(171.4, 0.3149), fullName: "43224, Columbus", scope: "zip" }, NOW, "city")).toEqual({
      adr: 171,
      occupancy: 0.31,
      scope: "zip",
      area: "43224, Columbus",
      at: NOW,
    });
    expect(figuresFrom({ ...summary(0, 0.5), fullName: null }, NOW, "city")).toBeNull();
    expect(figuresFrom({ ...summary(150, null as never), fullName: null }, NOW, "city")).toBeNull();
    expect(figuresFrom(null, NOW, "city")).toBeNull();
  });
});

describe("the city's figures", () => {
  beforeEach(() => {
    resetMarketFiguresMemory();
    stored.mockResolvedValue(new Map());
    keep.mockResolvedValue({ ok: true, detail: null });
    vi.mocked(hasAirRoiKey).mockReturnValue(true);
  });
  afterEach(() => vi.clearAllMocks());

  it("serves a fresh stored row without a call", async () => {
    stored.mockResolvedValue(new Map([[columbus.slug, { stats: { ...summary(160, 0.52), fullName: "Columbus, Ohio" }, at: NOW }]]));
    const f = await marketFigures(columbus);
    expect(f).toMatchObject({ adr: 160, occupancy: 0.52, scope: "city" });
    expect(liveMarket).not.toHaveBeenCalled();
  });

  it("buys the city by name, once, and keeps it", async () => {
    liveMarket.mockResolvedValue({
      summary: summary(166, 0.48),
      monthly: [],
      fullName: "Columbus, Ohio, United States",
      ref: { country: "United States", region: "Ohio", locality: "Columbus" },
      calls: 1,
      asOf: NOW,
    });
    const [a, b] = await Promise.all([marketFigures(columbus), marketFigures(columbus)]);
    expect(liveMarket).toHaveBeenCalledTimes(1);
    expect(liveMarket).toHaveBeenCalledWith(columbus, { identity: "catalogue", history: false });
    expect(a).toEqual({ adr: 166, occupancy: 0.48, scope: "city", area: "Columbus, Ohio, United States", at: NOW });
    expect(b).toEqual(a);
    expect(keep).toHaveBeenCalledWith(columbus.slug, expect.objectContaining({ adr: 166, scope: "city" }));
  });

  it("keeps a stale measurement over nothing when the feed does not answer", async () => {
    stored.mockResolvedValue(new Map([[columbus.slug, { stats: { ...summary(150, 0.5), fullName: null }, at: LONG_AGO }]]));
    liveMarket.mockResolvedValue(null);
    const f = await marketFigures(columbus);
    expect(f).toMatchObject({ adr: 150, at: LONG_AGO });
  });
});
