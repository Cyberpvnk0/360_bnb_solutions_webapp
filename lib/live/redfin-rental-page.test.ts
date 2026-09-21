import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRedfinRentalPage } from "./redfin-rental-page";
import { fetchRedfinRentals, mapRedfinRows, resetRedfinEscalation } from "./redfin";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import { geocodeAll } from "./geocode";
import { FURNISHED_BOSTON, PRIVATE_PHOTO, PRIVATE_PROSE, RENTAL_CACHE_KEY, rentalHome, rentalPage } from "./test-fixtures/redfin-rental-page";

vi.mock("./geocode", () => ({ geocodeAll: vi.fn(async () => []) }));
const boston = MARKET_BY_SLUG.get("boston")!;

describe("the measured furnished rental payload", () => {
  it("normalizes only listing facts, taking range minima and preserving source coordinates", () => {
    const result = parseRedfinRentalPage(rentalPage(), FURNISHED_BOSTON);
    expect(result).toEqual({ rows: [{
      address: "1 Example St", city: "Boston", state: "MA", zip: "02108",
      url: "https://www.redfin.com/MA/Boston/1-Example-St-02108/home/1",
      price: 2500, beds: 2, baths: 1.5, sqFt: 800, latitude: 42.35, longitude: -71.06,
    }], morePages: false });
    expect(JSON.stringify(result)).not.toContain(PRIVATE_PROSE);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_PHOTO);
    expect(JSON.stringify(result)).not.toContain("Unfurnished");
  });

  it.each([
    RENTAL_CACHE_KEY.replace("is_furnished=true", "is_furnished=false"),
    RENTAL_CACHE_KEY.replace("is_furnished=true&", ""),
    RENTAL_CACHE_KEY.replace("region_id=1826", "region_id=8907"),
    RENTAL_CACHE_KEY.replace("region_type=6", "region_type=2"),
    RENTAL_CACHE_KEY.replace("isRentals=true", "isRentals=false"),
    RENTAL_CACHE_KEY.replace("/search/rentals", "/search/sales"),
  ])("rejects a payload that does not prove the requested furnished search: %s", (key) => {
    expect(parseRedfinRentalPage(rentalPage(undefined, { key }), FURNISHED_BOSTON)).toBeNull();
  });

  it("does not assert furnished status from prose or an unfiltered target URL", () => {
    expect(parseRedfinRentalPage(rentalPage(), FURNISHED_BOSTON.replace("/filter/is-furnished", ""))).toBeNull();
    expect(parseRedfinRentalPage("<html>Fully furnished rentals</html>", FURNISHED_BOSTON)).toBeNull();
  });

  it("prefers individual homes over the duplicate building-consolidated response", () => {
    const consolidated = { res: { text: JSON.stringify({ homes: [rentalHome(99)], numMatchedHomes: 1 }) } };
    const result = parseRedfinRentalPage(rentalPage([rentalHome(), rentalHome()], {
      extra: { [RENTAL_CACHE_KEY + "&consolidateBuildings=true"]: consolidated },
    }), FURNISHED_BOSTON);
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].address).toBe("1 Example St");
  });

  it("accepts proven zero inventory and rejects missing, contradictory, or unusable rows", () => {
    expect(parseRedfinRentalPage(rentalPage([]), FURNISHED_BOSTON)).toEqual({ rows: [], morePages: false });
    expect(parseRedfinRentalPage(rentalPage([], { total: 20 }), FURNISHED_BOSTON)).toBeNull();
    expect(parseRedfinRentalPage(rentalPage([{ unknown: 1 }]), FURNISHED_BOSTON)).toBeNull();
    expect(parseRedfinRentalPage(rentalPage().replace('numMatchedHomes', 'unknownCount'), FURNISHED_BOSTON)).toBeNull();
  });

  it("reports when the embedded page omits more matches instead of claiming complete coverage", () => {
    expect(parseRedfinRentalPage(rentalPage(undefined, { total: 400 }), FURNISHED_BOSTON)?.morePages).toBe(true);
  });
});

beforeEach(() => {
  resetRedfinEscalation();
  vi.stubEnv("SCRAPERAPI_KEY", "test-secret");
  vi.stubEnv("REDFIN_SCRAPE_TIER", "premium");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function vendor(generic: () => Response = () => new Response(rentalPage(), { headers: { "sa-credit-cost": "20" } })) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    return url.pathname.startsWith("/structured/")
      ? new Response("Request failed. Protected domains may require premium=true", { status: 500 })
      : generic();
  }));
}

describe("structured-first furnished search", () => {
  it("falls back once on the same filtered URL, without escalation, geocoding, or prose", async () => {
    vendor();
    const result = await fetchRedfinRentals(boston, { furnished: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(fetch).mock.calls;
    expect(new URL(String(calls[0][0])).pathname).toContain("/structured/");
    expect(new URL(String(calls[1][0])).pathname).toBe("/");
    for (const [input] of calls) {
      const url = new URL(String(input));
      expect(url.searchParams.get("url")).toBe(FURNISHED_BOSTON);
      expect(url.searchParams.get("premium")).toBe("true");
      expect(url.searchParams.has("ultra_premium")).toBe(false);
    }
    expect(calls[1][1]?.cache).toBe("no-store");
    expect(geocodeAll).not.toHaveBeenCalled();
    expect(result.credits).toBe(20);
    expect(result.listings[0]).toMatchObject({
      rentMonthly: 2500, bedrooms: 2, bathrooms: 1.5, sqft: 800,
      features: ["Furnished"], featuresKnown: true, propertyTypeKnown: false,
    });
    expect(JSON.stringify(result)).not.toContain(PRIVATE_PROSE);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_PHOTO);
  });

  it("leaves a successful structured market on one structured call", async () => {
    const structured = { listings: [{ address: "1 Main St", price: 2500 }] };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(structured)));
    const result = await fetchRedfinRentals(MARKET_BY_SLUG.get("jacksonville")!, { furnished: true, map: false });
    expect(result.raw).toEqual(structured.listings);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/structured/");
  });

  it("preserves successful structured empty inventory without paying for a fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ listings: [] })));
    expect((await fetchRedfinRentals(boston, { furnished: true })).listings).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 429])("does not bypass an account or quota failure (%i)", async (status) => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("refused", { status })));
      await expect(fetchRedfinRentals(boston, { furnished: true })).rejects.toMatchObject({ status });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it.each([500, 403, 429])("never converts a generic failure (%i) into none after domain success", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ listings: [] })));
    await fetchRedfinRentals(boston, { furnished: true });
    vendor(() => new Response(PRIVATE_PROSE, { status }));
    await expect(fetchRedfinRentals(boston, { furnished: true })).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects an unrecognized HTML page instead of caching empty inventory", async () => {
    vendor(() => new Response("<html>Verify your browser</html>"));
    await expect(fetchRedfinRentals(boston, { furnished: true })).rejects.toMatchObject({ reason: "http" });
  });

  it("uses the fallback after a structured timeout, and propagates a generic timeout", async () => {
    vendor();
    vi.mocked(fetch).mockRejectedValueOnce(new DOMException("deadline", "TimeoutError"));
    expect((await fetchRedfinRentals(boston, { furnished: true })).listings).toHaveLength(1);
    vendor();
    vi.mocked(fetch).mockResolvedValueOnce(new Response("failed", { status: 500 }))
      .mockRejectedValueOnce(new DOMException("deadline", "TimeoutError"));
    await expect(fetchRedfinRentals(boston, { furnished: true })).rejects.toMatchObject({ reason: "timeout" });
  });

  it("falls back when the structured response body times out after the headers arrive", async () => {
    vendor();
    const stream = new ReadableStream({ start(controller) {
      controller.error(new DOMException("body deadline", "TimeoutError"));
    } });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(stream));
    expect((await fetchRedfinRentals(boston, { furnished: true })).listings).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("geocodes only missing points and keeps their indexes aligned in a mixed set", async () => {
    vi.mocked(geocodeAll).mockResolvedValueOnce([{ point: { lat: 42.2, lon: -71.2 }, source: "census", failure: null }]);
    const rows = [
      { address: "1 Main St", price: 2000, beds: 2, latitude: 42.3, longitude: -71.3 },
      { address: "2 Main St", price: 2500, beds: 2 },
    ];
    const mapped = await mapRedfinRows(rows, boston, { furnished: true });
    expect(geocodeAll).toHaveBeenCalledWith(["2 Main St, Boston, MA"]);
    expect(mapped.listings.map(l => l.lat)).toEqual([42.3, 42.2]);
  });
});
