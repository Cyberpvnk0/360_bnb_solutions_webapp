import { afterEach, describe, expect, it, vi } from "vitest";
import { requestMarketMeasurement } from "./measure-request";

const stats = {
  adr: 182, occupancy: 0.65, revpar: 118.3, revenue: 43179,
  activeListings: 312, bookingLeadTime: null, lengthOfStay: null,
  fullName: "Amarillo, Texas", scope: "city",
};
const at = "2026-09-21T16:00:00Z";

afterEach(() => vi.unstubAllGlobals());

describe("market measurement response", () => {
  it.each([0, 1])("delivers the returned figures directly, charged=%s", async (charged) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, stats, at, charged }));
    vi.stubGlobal("fetch", fetcher);
    expect(await requestMarketMeasurement("amarillo-tx")).toEqual({
      status: "done", measurement: { stats, at }, charged,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/markets/measure", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ market: "amarillo-tx" }),
      signal: expect.any(AbortSignal),
    });
  });

  it("keeps an insufficient balance distinct from an upstream failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: false, reason: "no-credits" }, { status: 402 })));
    expect(await requestMarketMeasurement("amarillo-tx")).toEqual({ status: "no-credits" });
  });

  it.each([null, { ok: true }, { ok: true, stats: [] }])("never treats a missing measurement as success: %j", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    expect(await requestMarketMeasurement("amarillo-tx")).toMatchObject({ status: "failed" });
  });

  it("preserves the server's failure message and does not retry a purchase", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: false, message: "No figures for that market yet." }, { status: 502 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await requestMarketMeasurement("amarillo-tx")).toEqual({ status: "failed", message: "No figures for that market yet." });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not retry an ambiguous network failure", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("Connection lost"));
    vi.stubGlobal("fetch", fetcher);
    expect(await requestMarketMeasurement("amarillo-tx")).toMatchObject({ status: "failed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
