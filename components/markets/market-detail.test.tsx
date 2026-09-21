import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MARKETS } from "@/lib/mock/markets";
import type { MeasureState } from "./use-measure-market";

const measurement = vi.hoisted(() => ({ state: { status: "idle" } as MeasureState, run: vi.fn() }));
const useMeasure = vi.hoisted(() => vi.fn());
vi.mock("./use-measure-market", () => ({ MEASURE_PRICE: "3 credits", useMeasureMarket: useMeasure }));
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
const months = [{ month: "2026-08-01", adr: 182, occupancy: 0.65, revpar: 118.3, revenue: null }];
const pace = Array.from({ length: 6 }, (_, i) => ({ date: "2026-10-0" + (i + 1), booked: 0.4, adr: 182, listings: 50 }));
const bundle = { months, monthsAt: "2026-09-21T16:00:00Z", pace, paceAt: "2026-09-21T16:00:00Z", errors: [] };
const props = {
  market: MARKETS[0], stats: null, statsAt: null, months: [], monthsAt: null,
  pace: [], paceAt: null, amenities: null, competition: null,
  listingsAt: null, areas: [], sizes: [], poolSize: 0,
};

beforeEach(() => {
  measurement.state = { status: "idle" };
  useMeasure.mockReset().mockImplementation(() => measurement);
});

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
    measurement.state = { status: "done", ...bundle, stats, at: "2026-09-21T16:00:00Z" };
    const html = renderToStaticMarkup(createElement(MarketDetail, props));
    expect(html).toContain("$43.2K");
    expect(html).toContain("65%");
    expect(html).toContain("$182");
    expect(html).not.toContain("Analyzing ");
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain("Twelve measured months");
    expect(html).toContain("Already reserved in");
    expect(html).not.toContain("Measure the year");
    expect(html).not.toContain("Measure what");
  });

  it("leaves an already measured market free of the loading notice", () => {
    const html = renderToStaticMarkup(createElement(MarketDetail, { ...props, ...bundle, stats, statsAt: "2026-09-21T16:00:00Z" }));
    expect(html).not.toContain("Analyzing ");
    expect(html).toContain("$182");
    expect(useMeasure).toHaveBeenCalledWith(expect.objectContaining({ wanted: false }));
  });

  it("automatically completes missing charts on an older measured market", () => {
    const html = renderToStaticMarkup(createElement(MarketDetail, { ...props, stats }));
    expect(useMeasure).toHaveBeenCalledWith(expect.objectContaining({ wanted: true }));
    expect(html).toContain("Analyzing ");
    expect(html).toContain("Measuring the year");
    expect(html).toContain("Measuring booked ahead");
    expect(html).toContain("$182");
  });

  it("shows a missing section's error alongside successfully returned facts", () => {
    measurement.state = { status: "done", ...bundle, stats, at: null, pace: [],
      errors: [{ section: "Booked ahead", message: "Booked ahead could not be fetched. This section was not charged." }] };
    const html = renderToStaticMarkup(createElement(MarketDetail, props));
    expect(html).toContain("$182");
    expect(html).toContain("Twelve measured months");
    expect(html).toContain("Booked ahead could not be fetched");
    expect(html).toContain("Retry missing figures");
    expect(html).not.toContain("Analyzing ");
  });

  it.each(["failed", "no-credits"] as const)("ends the loading state on %s", (status) => {
    measurement.state = status === "failed" ? { status, message: "Provider unavailable." } : { status };
    const html = renderToStaticMarkup(createElement(MarketDetail, props));
    expect(html).not.toContain("Analyzing ");
    expect(html).toContain(status === "failed" ? "Provider unavailable." : "Not enough credits");
  });
});
