import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CONCURRENCY,
  enrichTargets,
  MAX_ENRICH_PER_REQUEST,
  targetsFor,
} from "./enrich";
import { describeListing, extractListingText, listingSearchUrl } from "./scraperapi";
import type { RentalListing } from "@/lib/mock/types";

/** A phrase that appears nowhere else, so any leak is unmistakable. */
const SIGNATURE = "bring your bags and nothing else";
const PROSE = `Fully furnished riverside townhome — ${SIGNATURE}. Hot tub on the patio.`;

const HTML = {
  jsonLd: `<html><head><script type="application/ld+json">
    {"@type":"SingleFamilyResidence","description":"${PROSE}"}
  </script></head><body>x</body></html>`,
  nextData: `<html><body><script id="__NEXT_DATA__">
    {"props":{"pageProps":{"property":{"homeDescription":"${PROSE}"}}}}
  </script></body></html>`,
  meta: `<html><head><meta name="description" content="${PROSE}"></head></html>`,
  bare: `<html><body><div>${PROSE} ${"Additional listing copy. ".repeat(12)}</div></body></html>`,
  empty: `<html><body><p>hi</p></body></html>`,
};

function mockFetch(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  return vi.fn(async () =>
    new Response(body, {
      status: init.status ?? 200,
      headers: init.headers ?? {},
    })
  );
}

beforeEach(() => {
  process.env.SCRAPERAPI_KEY = "test-key";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SCRAPERAPI_KEY;
});

describe("extractListingText", () => {
  it("finds prose in each shape a listing page ships it in", () => {
    for (const [name, doc] of Object.entries(HTML)) {
      const found = extractListingText(doc);
      if (name === "empty") {
        expect(found, name).toBeNull();
        continue;
      }
      expect(found, name).not.toBeNull();
      expect(found!.text, name).toContain(SIGNATURE);
    }
  });

  it("reads a structured JSON response directly", () => {
    const found = extractListingText(
      JSON.stringify({ property: { description: PROSE } })
    );
    expect(found?.outcome.strategy).toBe("json");
    expect(found?.text).toContain(SIGNATURE);
  });

  it("prefers the precise strategy over the blunt one", () => {
    expect(extractListingText(HTML.jsonLd)?.outcome.strategy).toBe("json-ld");
    expect(extractListingText(HTML.bare)?.outcome.strategy).toBe("visible-text");
  });
});

describe("describeListing", () => {
  it("returns FLAGS and never the prose it read", async () => {
    vi.stubGlobal("fetch", mockFetch(HTML.jsonLd));
    const facts = await describeListing("12 River Rd", "Jacksonville", "FL");

    expect(facts.featuresKnown).toBe(true);
    expect(facts.features).toEqual(
      expect.arrayContaining(["Furnished", "Hot tub"])
    );
    // The invariant this whole module exists to keep: what comes back is
    // a fact about the property, not somebody else's sentence about it.
    const serialized = JSON.stringify(facts);
    expect(serialized).not.toContain(SIGNATURE);
    expect(serialized).not.toContain("riverside townhome");
    expect(facts).not.toHaveProperty("description");
    expect(facts).not.toHaveProperty("text");
  });

  it("reports length without reporting content", async () => {
    vi.stubGlobal("fetch", mockFetch(HTML.meta));
    const facts = await describeListing("12 River Rd", "Jacksonville", "FL");
    expect(facts.textLength).toBeGreaterThan(0);
    expect(JSON.stringify(facts)).not.toContain(SIGNATURE);
  });

  it("says unknown — not 'has none' — when a page has nothing to read", async () => {
    vi.stubGlobal("fetch", mockFetch(HTML.empty));
    const facts = await describeListing("12 River Rd", "Jacksonville", "FL");
    expect(facts.featuresKnown).toBe(false);
    expect(facts.features).toEqual([]);
  });

  it("tries the cheap path first and escalates only on a miss", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(HTML.empty))
      .mockResolvedValueOnce(new Response(HTML.jsonLd));
    vi.stubGlobal("fetch", fetchMock);

    const facts = await describeListing("12 River Rd", "Jacksonville", "FL");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("render=true");
    expect(String(fetchMock.mock.calls[1][0])).toContain("render=true");
    expect(facts.rendered).toBe(true);
    expect(facts.featuresKnown).toBe(true);
  });

  it("never pays for rendering when the cheap path worked", async () => {
    const fetchMock = mockFetch(HTML.jsonLd);
    vi.stubGlobal("fetch", fetchMock);
    const facts = await describeListing("12 River Rd", "Jacksonville", "FL");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(facts.rendered).toBe(false);
  });

  it("respects SCRAPERAPI_ALLOW_RENDER=0 as a hard spend cap", async () => {
    process.env.SCRAPERAPI_ALLOW_RENDER = "0";
    const fetchMock = mockFetch(HTML.empty);
    vi.stubGlobal("fetch", fetchMock);
    const facts = await describeListing("12 River Rd", "Jacksonville", "FL");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(facts.featuresKnown).toBe(false);
    delete process.env.SCRAPERAPI_ALLOW_RENDER;
  });

  it("reads the address the app already links to", () => {
    const url = listingSearchUrl("12 River Rd", "Jacksonville", "FL");
    expect(url).toContain("zillow.com/homes/for_rent/");
    expect(url).toContain(encodeURIComponent("12 River Rd, Jacksonville, FL"));
  });

  it("throws a named reason the UI can explain", async () => {
    vi.stubGlobal("fetch", mockFetch("nope", { status: 401 }));
    await expect(
      describeListing("12 River Rd", "Jacksonville", "FL")
    ).rejects.toMatchObject({ reason: "auth" });
  });
});

describe("enrichTargets", () => {
  const targets = [
    { id: "live--jacksonville--a", address: "1 A St", city: "Jacksonville", stateCode: "FL" },
    { id: "live--jacksonville--b", address: "2 B St", city: "Jacksonville", stateCode: "FL" },
  ];

  it("returns flags per id and no prose anywhere in the batch", async () => {
    vi.stubGlobal("fetch", mockFetch(HTML.jsonLd));
    const batch = await enrichTargets(targets);

    expect(batch.resolved).toBe(2);
    expect(batch.facts["live--jacksonville--a"].features).toContain("Furnished");
    expect(batch.facts["live--jacksonville--a"].featuresKnown).toBe(true);
    expect(JSON.stringify(batch)).not.toContain(SIGNATURE);
  });

  it("one bad address doesn't cost the others their answer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValue(new Response(HTML.jsonLd));
    vi.stubGlobal("fetch", fetchMock);

    const batch = await enrichTargets(targets);
    expect(batch.attempted).toBe(2);
    expect(batch.resolved).toBe(1);
    expect(batch.records.some((r) => r.failure === "blocked")).toBe(true);
  });

  it("writes no fact for a row it could not read", async () => {
    vi.stubGlobal("fetch", mockFetch("boom", { status: 500 }));
    const batch = await enrichTargets(targets);
    // Silence, not a false negative: these rows stay unknown so the
    // filter excludes them rather than counting them as unfurnished.
    expect(batch.facts).toEqual({});
    expect(batch.resolved).toBe(0);
  });
});

describe("targetsFor", () => {
  const row = (over: Partial<RentalListing>): RentalListing =>
    ({
      id: "live--jacksonville--1",
      analysisId: "r--live--jacksonville--1",
      address: "1 A St",
      city: "Jacksonville",
      stateCode: "FL",
      marketSlug: "jacksonville",
      lat: 30.3,
      lon: -81.6,
      bedrooms: 2,
      bathrooms: 2,
      sqft: 900,
      propertyType: "condo",
      rentMonthly: 1800,
      daysOnMarket: 3,
      petFriendly: false,
      features: [],
      ...over,
    }) as RentalListing;

  it("spends only on live rows whose amenities are still unknown", () => {
    const ids = targetsFor([
      row({ id: "live--jacksonville--1", featuresKnown: false }),
      // Already read once — never pay for the same row twice.
      row({ id: "live--jacksonville--2", featuresKnown: true }),
      // Preview inventory carries its own tags.
      row({ id: "rl--jacksonville--3", featuresKnown: false }),
    ]).map((t) => t.id);

    expect(ids).toEqual(["live--jacksonville--1"]);
  });
});

describe("batching and pacing", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    id: `live--jacksonville--${i}`,
    address: `${i} Main St`,
    city: "Jacksonville",
    stateCode: "FL",
  }));

  it("defaults to the vendor's trial concurrency, not a guess", () => {
    // ScraperAPI caps concurrent threads by plan and answers 429 past
    // it. Defaulting above the trial limit would make a first test fail
    // for a reason that has nothing to do with the data.
    expect(DEFAULT_CONCURRENCY).toBe(5);
  });

  it("never reads more than one batch per request", async () => {
    const fetchMock = mockFetch(HTML.jsonLd);
    vi.stubGlobal("fetch", fetchMock);
    const batch = await enrichTargets(many);
    expect(batch.attempted).toBe(MAX_ENRICH_PER_REQUEST);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_ENRICH_PER_REQUEST);
  });

  it("holds concurrent reads to the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return new Response(HTML.jsonLd);
      })
    );
    await enrichTargets(many);
    expect(peak).toBeLessThanOrEqual(DEFAULT_CONCURRENCY);
  });

  it("times every read so a page's duration can be predicted", async () => {
    vi.stubGlobal("fetch", mockFetch(HTML.jsonLd));
    const batch = await enrichTargets(many.slice(0, 3));
    expect(batch.ms).toBeGreaterThanOrEqual(0);
    for (const r of batch.records) {
      expect(Number.isFinite(r.ms)).toBe(true);
    }
  });
});
