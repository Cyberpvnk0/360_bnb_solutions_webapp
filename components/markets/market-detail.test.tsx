import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MARKETS } from "@/lib/mock/markets";
import type { MeasureState } from "./use-measure-market";

const measurement = vi.hoisted(() => ({ state: { status: "idle" } as MeasureState, run: vi.fn() }));
vi.mock("./use-measure-market", () => ({ MEASURE_PRICE: "1 credit", useMeasureMarket: () => measurement }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/providers/session-provider", () => ({
  useSession: () => ({ user: null, watchedMarketSlugs: [], creditsRemaining: 10, credits: 0, openUpgrade: vi.fn(), refreshUsage: vi.fn() }),
}));

import { MarketDetail } from "./market-detail";

const stats = {
  adr: 182, occupancy: 0.65, revpar: 118.3, revenue: 43179,
  activeListings: 312, bookingLeadTime: null, lengthOfStay: null,
  fullName: "Amarillo, Texas", scope: "city" as const,
};
const props = {
  market: MARKETS[0], stats: null, statsAt: null, months: [], monthsAt: null,
  pace: [], paceAt: null, amenities: null, competition: null,
  listingsAt: null, areas: [], sizes: [], poolSize: 0,
};

beforeEach(() => { measurement.state = { status: "idle" }; });

describe("market measurement display", () => {
  it.each(["idle", "measuring"] as const)("shows a prominent status during %s", (status) => {
    measurement.state = { status };
    const html = renderToStaticMarkup(createElement(MarketDetail, props));
    expect(html).toContain("Analyzing ");
    expect(html).toContain("10–15 seconds");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
  });

  it("renders the bought figures before server props refresh", () => {
    measurement.state = { status: "done", stats, at: "2026-09-21T16:00:00Z" };
    const html = renderToStaticMarkup(createElement(MarketDetail, props));
    expect(html).toContain("$43.2K");
    expect(html).toContain("65%");
    expect(html).toContain("$182");
    expect(html).not.toContain("Analyzing ");
    expect(html).toContain('aria-busy="false"');
  });

  it("leaves an already measured market free of the loading notice", () => {
    const html = renderToStaticMarkup(createElement(MarketDetail, { ...props, stats, statsAt: "2026-09-21T16:00:00Z" }));
    expect(html).not.toContain("Analyzing ");
    expect(html).toContain("$182");
  });

  it.each(["failed", "no-credits"] as const)("ends the loading state on %s", (status) => {
    measurement.state = status === "failed" ? { status, message: "Provider unavailable." } : { status };
    const html = renderToStaticMarkup(createElement(MarketDetail, props));
    expect(html).not.toContain("Analyzing ");
    expect(html).toContain(status === "failed" ? "Provider unavailable." : "no credits left");
  });
});
