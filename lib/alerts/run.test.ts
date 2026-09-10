import { describe, expect, it, vi } from "vitest";
import { runAlerts, type AlertRow, type RunDeps } from "./run";
import type { RentalListing } from "@/lib/mock/types";

const listing = (id: string, over: Partial<RentalListing> = {}): RentalListing => ({
  id,
  analysisId: `r--${id}`,
  address: `${id} Main St`,
  city: "Jacksonville",
  stateCode: "FL",
  marketSlug: "jacksonville",
  lat: 30.33,
  lon: -81.66,
  bedrooms: 2,
  bathrooms: 1,
  sqft: 900,
  propertyType: "house",
  rentMonthly: 1450,
  petFriendly: false,
  features: ["Furnished"],
  featuresKnown: true,
  ...over,
});

const alert = (over: Partial<AlertRow> = {}): AlertRow => ({
  id: "a1",
  userId: "u1",
  email: "a@b.co",
  marketSlug: "jacksonville",
  zip: null,
  label: "Jacksonville, FL",
  criteria: { furnishedOnly: true, beds: [1, 2], baths: [], types: [], rentMin: null, rentMax: null },
  wantsEmail: true,
  wantsPush: true,
  seenIds: ["old"],
  lastRunAt: "2026-09-09T13:00:00.000Z",
  ...over,
});

function deps(listings: RentalListing[]) {
  return {
    listingsFor: vi.fn<RunDeps["listingsFor"]>(async () => listings),
    sendEmail: vi.fn<RunDeps["sendEmail"]>(async () => ({ ok: true, detail: null })),
    pushTo: vi.fn<RunDeps["pushTo"]>(async () => 2),
    save: vi.fn<RunDeps["save"]>(async () => undefined),
    appUrl: "https://app.example",
    now: new Date("2026-09-10T13:00:00.000Z"),
  };
}

describe("the morning run", () => {
  it("only takes a snapshot the first time, and tells nobody", async () => {
    const d = deps([listing("old"), listing("new")]);
    const report = await runAlerts([alert({ lastRunAt: null, seenIds: [] })], d);
    expect(report.seeded).toBe(1);
    expect(report.notified).toBe(0);
    expect(d.sendEmail).not.toHaveBeenCalled();
    expect(d.save).toHaveBeenCalledWith("a1", { seenIds: ["old", "new"], lastRunAt: "2026-09-10T13:00:00.000Z" });
  });

  it("writes about a rental that appeared since, when it fits, and remembers the area", async () => {
    const d = deps([listing("old"), listing("new"), listing("big", { bedrooms: 4 })]);
    const report = await runAlerts([alert()], d);
    expect(report).toMatchObject({ alerts: 1, areas: 1, notified: 1, emails: 1, pushes: 2, failures: [] });
    const mail = d.sendEmail.mock.calls[0][0]!;
    expect(mail.to).toBe("a@b.co");
    expect(mail.subject).toBe("1 new rental in Jacksonville, FL matches your alert");
    expect(mail.html).toContain("new Main St");
    expect(mail.html).not.toContain("big Main St");
    expect(mail.html).toContain("https://app.example/analyze/new?");
    expect(d.pushTo).toHaveBeenCalledWith("u1", {
      title: "1 new rental in Jacksonville, FL",
      body: "new Main St · $1,450/mo",
      url: "https://app.example/deals?market=jacksonville",
    });
    expect(d.save).toHaveBeenCalledWith("a1", { seenIds: ["old", "new", "big"], lastRunAt: "2026-09-10T13:00:00.000Z" });
  });

  it("stays quiet when nothing new fits, reads an area once for everyone watching it, and honours each channel", async () => {
    const d = deps([listing("old"), listing("new")]);
    const report = await runAlerts(
      [
        alert({ id: "a1", wantsPush: false }),
        alert({ id: "a2", userId: "u2", email: "c@d.co", wantsEmail: false }),
        alert({ id: "a3", criteria: { furnishedOnly: false, beds: [4], baths: [], types: [], rentMin: null, rentMax: null } }),
      ],
      d
    );
    expect(d.listingsFor).toHaveBeenCalledTimes(1);
    expect(report.notified).toBe(2);
    expect(d.sendEmail).toHaveBeenCalledTimes(1);
    expect(d.pushTo).toHaveBeenCalledTimes(1);
    expect(d.pushTo).toHaveBeenCalledWith("u2", expect.anything());
    expect(d.save).toHaveBeenCalledTimes(3);
  });

  it("reports an area whose feed failed and leaves its alerts as they were", async () => {
    const d = deps([]);
    d.listingsFor.mockRejectedValueOnce(new Error("quota"));
    const report = await runAlerts([alert()], d);
    expect(report.failures).toEqual(["market:jacksonville: quota"]);
    expect(d.save).not.toHaveBeenCalled();
  });

  it("counts a mail that could not be sent as a failure, not a delivery", async () => {
    const d = deps([listing("old"), listing("new")]);
    d.sendEmail.mockResolvedValueOnce({ ok: false, detail: "HTTP 401" });
    const report = await runAlerts([alert({ wantsPush: false })], d);
    expect(report.emails).toBe(0);
    expect(report.failures).toEqual(["a1: mail HTTP 401"]);
  });
});
