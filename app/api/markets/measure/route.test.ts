import { beforeEach, describe, expect, it, vi } from "vitest";
import { MARKET_MEASURE_CREDITS } from "@/config/app";

const mocks = vi.hoisted(() => ({
  gate: vi.fn(), cover: vi.fn(), spend: vi.fn(),
  stats: vi.fn(), year: vi.fn(), pace: vi.fn(),
  buyStats: vi.fn(), buyYear: vi.fn(), buyPace: vi.fn(),
}));
vi.mock("@/lib/auth/gate", () => ({ requireMarketAnalyzer: mocks.gate }));
vi.mock("@/lib/db/usage", () => ({ canCover: mocks.cover, spendCredits: mocks.spend }));
vi.mock("@/lib/live/market-measure", () => ({
  storedMarketStats: mocks.stats, buyMarketStats: mocks.buyStats, measureKey: (s: string) => `market:${s}`,
}));
vi.mock("@/lib/live/market-history", () => ({
  storedMarketMonths: mocks.year, buyMarketMonths: mocks.buyYear, historyKey: (s: string) => `market-months:${s}`,
}));
vi.mock("@/lib/live/market-pacing", () => ({
  storedMarketPacing: mocks.pace, buyMarketPacing: mocks.buyPace, pacingKey: (s: string) => `market-pace:${s}`,
}));
import { POST } from "./route";

const at = "2026-09-21T16:00:00Z";
const stats = { adr: 180, occupancy: 0.6, revenue: 39420, activeListings: 200 };
const months = [{ month: "2026-08-01", adr: 180, occupancy: 0.6, revenue: null, revpar: 108 }];
const days = [{ date: "2026-10-01", booked: 0.4, adr: 180, listings: 200 }];
const request = (market = "anaheim") => new Request("http://localhost/api/markets/measure", {
  method: "POST", body: JSON.stringify({ market }),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.gate.mockResolvedValue({ ok: true, user: { id: "u1" }, tier: "scale" });
  mocks.cover.mockResolvedValue({ ok: true, remaining: 10 });
  mocks.spend.mockResolvedValue({ allowed: true, charged: 1 });
  mocks.stats.mockResolvedValue(null); mocks.year.mockResolvedValue(null); mocks.pace.mockResolvedValue(null);
  mocks.buyStats.mockResolvedValue({ ok: true, stats, at, bought: true });
  mocks.buyYear.mockResolvedValue({ ok: true, months, at, bought: true });
  mocks.buyPace.mockResolvedValue({ ok: true, days, at, bought: true });
});

describe("automatic market analysis bundle", () => {
  it("returns all three sections and charges three credits for a new market", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, complete: true, stats, months, pace: days, charged: 3, errors: [] });
    expect(MARKET_MEASURE_CREDITS).toBe(3);
    expect(mocks.cover).toHaveBeenCalledWith("u1", "scale", 3);
    expect(mocks.spend.mock.calls.map((c) => [c[2], c[3]])).toEqual([
      ["market:anaheim", 1], ["market-months:anaheim", 1], ["market-pace:anaheim:2026-09", 1],
    ]);
  });

  it("starts all provider requests without waiting for the headline response", async () => {
    let finish!: (value: unknown) => void;
    mocks.buyStats.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = POST(request());
    await vi.waitFor(() => expect(mocks.buyPace).toHaveBeenCalledOnce());
    expect(mocks.buyYear).toHaveBeenCalledOnce();
    expect(mocks.spend).not.toHaveBeenCalled();
    finish({ ok: true, stats, at, bought: true });
    await pending;
  });

  it("serves a completed cache free before checking balance", async () => {
    mocks.stats.mockResolvedValue({ stats, at }); mocks.year.mockResolvedValue({ months, at }); mocks.pace.mockResolvedValue({ days, at });
    expect(await (await POST(request())).json()).toMatchObject({ complete: true, charged: 0 });
    for (const fn of [mocks.cover, mocks.spend, mocks.buyStats, mocks.buyYear, mocks.buyPace]) expect(fn).not.toHaveBeenCalled();
  });

  it("automatically completes a legacy market, charging only its missing section", async () => {
    mocks.stats.mockResolvedValue({ stats, at }); mocks.year.mockResolvedValue({ months, at });
    expect(await (await POST(request())).json()).toMatchObject({ complete: true, charged: 1 });
    expect(mocks.cover).toHaveBeenCalledWith("u1", "scale", 1);
    expect(mocks.buyStats).not.toHaveBeenCalled(); expect(mocks.buyYear).not.toHaveBeenCalled();
    expect(mocks.spend).toHaveBeenCalledOnce();
  });

  it("recognizes fresh history stored inline by a previous backfill", async () => {
    mocks.stats.mockResolvedValue({ stats: { ...stats, monthly: months }, at });
    await POST(request());
    expect(mocks.buyYear).not.toHaveBeenCalled();
    expect(mocks.cover).toHaveBeenCalledWith("u1", "scale", 1);
  });

  it("buys nothing when the account cannot cover the missing sections", async () => {
    mocks.cover.mockResolvedValue({ ok: false, remaining: 2 });
    const response = await POST(request());
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ reason: "no-credits", cost: 3 });
    for (const fn of [mocks.spend, mocks.buyStats, mocks.buyYear, mocks.buyPace]) expect(fn).not.toHaveBeenCalled();
  });

  it.each([false, true])("preserves successful sections and does not charge a failed section (throw=%s)", async (throws) => {
    if (throws) mocks.buyYear.mockRejectedValue(new Error("Provider down"));
    else mocks.buyYear.mockResolvedValue({ ok: false, reason: "failed" });
    expect(await (await POST(request())).json()).toMatchObject({
      ok: true, complete: false, charged: 2, stats, months: [], pace: days,
      errors: [{ section: "Through the year" }],
    });
    expect(mocks.spend.mock.calls.some((c) => c[2] === "market-months:anaheim")).toBe(false);
  });

  it("surfaces total provider failure as an error with no charge", async () => {
    for (const fn of [mocks.buyStats, mocks.buyYear, mocks.buyPace]) fn.mockResolvedValue({ ok: false, reason: "failed" });
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ ok: false, charged: 0 });
    expect(mocks.spend).not.toHaveBeenCalled();
  });

  it("respects the atomic ledger's duplicate or raced-spend result", async () => {
    mocks.spend.mockResolvedValueOnce({ allowed: true, charged: 0 })
      .mockResolvedValueOnce({ allowed: false, charged: 0 });
    expect(await (await POST(request())).json()).toMatchObject({ ok: true, charged: 1 });
  });

  it("requires the existing authorization gate", async () => {
    mocks.gate.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.stats).not.toHaveBeenCalled();
  });

  it("rejects unknown markets before touching the cache or credit balance", async () => {
    expect((await POST(request("unknown"))).status).toBe(404);
    expect(mocks.stats).not.toHaveBeenCalled(); expect(mocks.cover).not.toHaveBeenCalled();
  });
});
