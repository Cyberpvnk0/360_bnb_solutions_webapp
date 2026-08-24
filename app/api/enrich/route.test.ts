import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnrichLedger } from "@/lib/live/quota";
import { GET } from "./route";

/**
 * The probe is a diagnostic people spend real vendor credits on, so it
 * gets the same scrutiny as the code it measures: the numbers it reports
 * must be arithmetically right, and no listing prose may ride along.
 */

const PROSE =
  "Fully furnished 2 bedroom on the river — bring your bags and nothing " +
  "else. Two car garage and a private pool.";

/** A RentCast row shaped like the real feed: no description field. */
const rcRow = (i: number) => ({
  id: `rc-${i}`,
  formattedAddress: `${100 + i} Riverside Ave, Jacksonville, FL 32204`,
  addressLine1: `${100 + i} Riverside Ave`,
  city: "Jacksonville",
  state: "FL",
  latitude: 30.32 + i * 0.003,
  longitude: -81.66 + i * 0.003,
  propertyType: "Condo",
  bedrooms: 2,
  bathrooms: 2,
  squareFootage: 950,
  price: 1700 + i * 25,
  status: "Active",
  daysOnMarket: i,
});

/** Route fetch by host: RentCast returns rows, ScraperAPI returns pages. */
function stubVendors({ readable }: { readable: (i: number) => boolean }) {
  let scrapes = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("rentcast.io")) {
        return new Response(
          JSON.stringify(Array.from({ length: 8 }, (_, i) => rcRow(i)))
        );
      }
      const mine = scrapes++;
      const body = readable(mine)
        ? `<html><head><script type="application/ld+json">${JSON.stringify({
            description: PROSE,
          })}</script></head><body>x</body></html>`
        : `<html><body><p>nothing here</p></body></html>`;
      return new Response(body, { headers: { "sa-credit-cost": "11" } });
    })
  );
}

beforeEach(() => {
  resetEnrichLedger();
  process.env.RENTCAST_API_KEY = "test-rc";
  process.env.SCRAPERAPI_KEY = "test-sa";
  // Keep the run to the cheap path so scrape counts stay predictable.
  process.env.SCRAPERAPI_ALLOW_RENDER = "0";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RENTCAST_API_KEY;
  delete process.env.SCRAPERAPI_KEY;
  delete process.env.SCRAPERAPI_ALLOW_RENDER;
});

async function probe(n: number) {
  const res = await GET(
    new Request(`http://localhost/api/enrich?probe=jacksonville&n=${n}`)
  );
  return { status: res.status, body: await res.json() };
}

describe("GET /api/enrich?probe", () => {
  it("reports a resolve rate that matches what actually resolved", async () => {
    // Every other page readable → a true 50%.
    stubVendors({ readable: (i) => i % 2 === 0 });
    const { body } = await probe(8);

    expect(body.ok).toBe(true);
    expect(body.attempted).toBe(8);
    expect(body.resolved).toBe(4);
    expect(body.resolveRate).toBe("50%");
    expect(body.furnishedFound).toBe(4);
  });

  it("reports credits and timing a spend decision can rest on", async () => {
    stubVendors({ readable: () => true });
    const { body } = await probe(8);

    // 8 reads at the header's 11 credits each.
    expect(body.creditsSpent).toBe(88);
    expect(body.creditsPerProperty).toBe(11);
    expect(body.msPerProperty).toBeGreaterThanOrEqual(0);
    expect(body.msSlowest).toBeGreaterThanOrEqual(body.msPerProperty);
    expect(body.msBatch).toBeGreaterThanOrEqual(0);
  });

  it("names where the text was found", async () => {
    stubVendors({ readable: () => true });
    const { body } = await probe(8);
    expect(body.strategies).toEqual({ "json-ld": 8 });
    expect(body.renderedCount).toBe(0);
  });

  it("carries no listing prose, only counts", async () => {
    stubVendors({ readable: () => true });
    const { body } = await probe(8);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("bring your bags");
    expect(serialized).not.toContain("Fully furnished");
  });

  it("says which vendor failed rather than reporting a bad zero", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 }))
    );
    const { status, body } = await probe(8);
    expect(status).toBe(502);
    expect(body.stage).toBe("rentcast");
    expect(body.reason).toBe("auth");
  });

  it("refuses an unknown market instead of guessing one", async () => {
    stubVendors({ readable: () => true });
    const res = await GET(
      new Request("http://localhost/api/enrich?probe=not-a-market")
    );
    expect(res.status).toBe(404);
  });
});
