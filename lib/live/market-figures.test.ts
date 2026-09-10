import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  figuresFrom,
  marketFigures,
  resetMarketFiguresMemory,
  zipFigures,
  zipFiguresSlug,
} from "./market-figures";
import { fetchMarketIdentity, fetchMarketSummary, hasAirRoiKey } from "./airroi";
import { fetchLiveMarket } from "./market-live";
import { readMarketStatsFor, writeMarketStats } from "@/lib/db/market-store";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

vi.mock("./airroi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./airroi")>()),
  fetchMarketIdentity: vi.fn(),
  fetchMarketSummary: vi.fn(),
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
const byName = vi.mocked(fetchMarketSummary);
const byPoint = vi.mocked(fetchMarketIdentity);
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

describe("a ZIP's figures", () => {
  beforeEach(() => {
    resetMarketFiguresMemory();
    stored.mockResolvedValue(new Map());
    keep.mockResolvedValue({ ok: true, detail: null });
    vi.mocked(hasAirRoiKey).mockReturnValue(true);
  });
  afterEach(() => vi.clearAllMocks());

  it("asks by name — the city and the ZIP as its district — and keeps the answer a month", async () => {
    byName.mockResolvedValue({ summary: summary(158.4, 0.41), fullName: "43224, Columbus, Ohio, United States" });
    const f = await zipFigures("43224", columbus);
    expect(byName).toHaveBeenCalledWith({
      country: "United States",
      region: columbus.state,
      locality: columbus.name,
      district: "43224",
    });
    expect(f).toMatchObject({ adr: 158, occupancy: 0.41, scope: "zip", area: "43224, Columbus, Ohio, United States" });
    expect(keep).toHaveBeenCalledWith(zipFiguresSlug("43224"), expect.objectContaining({ scope: "zip", adr: 158.4 }));
    expect(byPoint).not.toHaveBeenCalled();
  });

  it("serves a fresh stored ZIP without a call", async () => {
    stored.mockResolvedValue(new Map([[zipFiguresSlug("43224"), { stats: { ...summary(150, 0.4), fullName: null, scope: "zip" }, at: NOW }]]));
    const f = await zipFigures("43224", columbus);
    expect(f).toMatchObject({ adr: 150, scope: "zip" });
    expect(byName).not.toHaveBeenCalled();
  });

  it("lets the feed name the point's own market when the name gives nothing", async () => {
    byName
      .mockResolvedValueOnce({ summary: summary(0, null as never), fullName: null })
      .mockResolvedValueOnce({ summary: summary(140, 0.38), fullName: null });
    byPoint.mockResolvedValue({
      fullName: "43224, Columbus, Ohio, United States",
      market: { country: "United States", region: "Ohio", locality: "Columbus", district: "43224" },
    });
    const f = await zipFigures("43224", columbus, { lat: 39.99, lon: -82.97 });
    expect(byPoint).toHaveBeenCalledWith({ lat: 39.99, lon: -82.97 });
    expect(byName).toHaveBeenCalledTimes(2);
    expect(f).toMatchObject({ adr: 140, occupancy: 0.38, area: "43224, Columbus, Ohio, United States" });
  });

  it("answers null for a ZIP the feed has nothing on, keeps nothing, and does not ask again for a while", async () => {
    byName.mockResolvedValue({ summary: summary(0, null as never), fullName: null });
    expect(await zipFigures("43224", columbus)).toBeNull();
    expect(await zipFigures("43224", columbus)).toBeNull();
    expect(byName).toHaveBeenCalledTimes(1);
    expect(keep).not.toHaveBeenCalled();
  });

  it("refuses anything but five digits, and asks for nothing without a key", async () => {
    expect(await zipFigures("4322", columbus)).toBeNull();
    vi.mocked(hasAirRoiKey).mockReturnValue(false);
    expect(await zipFigures("43224", columbus)).toBeNull();
    expect(byName).not.toHaveBeenCalled();
  });
});
