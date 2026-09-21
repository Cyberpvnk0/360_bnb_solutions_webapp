import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/gate", () => ({
  requireOperator: vi.fn(async () => ({ ok: true })),
  claimMarket: vi.fn(async () => ({ allowed: true, used: 1, cap: 10 })),
  monthlyCap: vi.fn(),
}));

vi.mock("@/lib/db/market-store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db/market-store")>(),
  readFurnished: vi.fn(async () => null),
  writeFurnished: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/live/quota", () => ({
  checkLiveSearch: vi.fn(() => ({ allowed: true, remaining: 10, cap: 10 })),
  commitLiveSearch: vi.fn(() => ({ remaining: 9, cap: 10 })),
}));

import { requireOperator } from "@/lib/auth/gate";
import { furnishedKey, FURNISHED_TTL_MS, readFurnished, writeFurnished } from "@/lib/db/market-store";
import { commitLiveSearch } from "@/lib/live/quota";
import { resetRedfinEscalation } from "@/lib/live/redfin";
import { PRIVATE_PHOTO, PRIVATE_PROSE, rentalPage } from "@/lib/live/test-fixtures/redfin-rental-page";
import { GET } from "./route";

const PROSE = "A private listing description that must never leave the parser.";
const PHOTO = "https://photos.example.test/private-listing.jpg";
const ADDRESS = "123 Example Street";

function page() {
  // This synthetic schema exercises the diagnostic, not a guessed mapper.
  return `<script>root.__reactServerState.InitialContext = ${JSON.stringify({
    search: {
      results: [{ address: ADDRESS, rent: 2345, description: PROSE, photo: PHOTO }],
    },
  })};</script>`;
}

const ask = (query = "") => GET(
  new Request(`http://localhost/api/redfin?market=boston&pageShape=1${query}`)
);

beforeEach(() => {
  resetRedfinEscalation();
  vi.mocked(readFurnished).mockResolvedValue(null);
  vi.stubEnv("SCRAPERAPI_KEY", "test-secret-key");
  vi.stubEnv("REDFIN_SCRAPE_TIER", "premium");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(page(), {
    headers: { "sa-credit-cost": "10" },
  })));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the furnished page shape probe", () => {
  it("uses one generic premium request with the furnished filter and no document cache", async () => {
    const response = await ask();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [input, options] = vi.mocked(fetch).mock.calls[0];
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe("https://api.scraperapi.com/");
    expect(url.searchParams.get("url")).toBe(
      "https://www.redfin.com/city/1826/MA/Boston/apartments-for-rent/filter/is-furnished"
    );
    expect(url.searchParams.get("premium")).toBe("true");
    expect(options?.cache).toBe("no-store");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports the embedded schema without prose, photos, addresses, rents, or keys", async () => {
    const body = await (await ask()).json();
    expect(body.credits).toBe(10);
    expect(body.blobs[0].arrays[0]).toMatchObject({
      path: "search.results",
      length: 1,
      fields: { address: { types: ["string"] }, rent: { types: ["number"] } },
    });
    const serialized = JSON.stringify(body);
    for (const value of [PROSE, PHOTO, ADDRESS, "2345", "test-secret-key"]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("passes an explicit tier and path to the actual request", async () => {
    await ask("&tier=ultra&path=rentals");
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.searchParams.get("ultra_premium")).toBe("true");
    expect(url.searchParams.has("premium")).toBe(false);
    expect(url.searchParams.get("url")).toContain("/rentals/filter/is-furnished");
  });

  it.each(["&tier=constructor", "&tier=invalid", "&path=https://other.test/"])(
    "rejects invalid options before spending credits: %s", async (query) => {
      expect((await ask(query)).status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it("checks operator access before any vendor request", async () => {
    vi.mocked(requireOperator).mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: "forbidden" }, { status: 403 }),
    } as Awaited<ReturnType<typeof requireOperator>>);
    expect((await ask()).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns a fetch failure without leaking even an HTML error body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(`<html>${PROSE}</html>`, { status: 500 }));
    const response = await ask();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ live: false, reason: "http", status: 500, detail: null });
  });

  it("reports a timeout instead of an empty result", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new DOMException("deadline", "TimeoutError"));
    const response = await ask();
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ live: false, reason: "timeout" });
  });

  it("does not mistake a page without JSON for proven empty inventory", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("<html>Verify your browser</html>"));
    const body = await (await ask()).json();
    expect(body.blobs).toEqual([]);
    expect(body).not.toHaveProperty("listings");
  });

  it("reports JSON-encoded rental rows behind literal dotted keys without listing values", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(rentalPage()));
    const body = await (await ask()).json();
    const homes = body.blobs[0].arrays.find((a: { path: string }) => a.path.endsWith(".homes"));
    expect(homes.length).toBe(1);
    expect(homes.fields["rentalExtension.rentPriceRange.min"].types).toEqual(["number"]);
    expect(JSON.stringify(body)).not.toContain(PRIVATE_PROSE);
    expect(JSON.stringify(body)).not.toContain(PRIVATE_PHOTO);
    expect(JSON.stringify(body)).not.toContain("1 Example St");
  });
});

describe("the existing seven-day furnished store", () => {
  const search = () => GET(new Request("http://localhost/api/redfin?market=boston&furnished=1"));

  it("stores fallback facts under the existing key and serves the next visit without vendor calls", async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      new URL(String(input)).pathname.startsWith("/structured/")
        ? new Response("failed", { status: 500 })
        : new Response(rentalPage())
    );
    const first = await (await search()).json();
    expect(first.live).toBe(true);
    expect(first.cached).toBe(false);
    expect(first.listings).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(writeFurnished).toHaveBeenCalledTimes(1);
    const [key, set] = vi.mocked(writeFurnished).mock.calls[0];
    expect(key).toBe(furnishedKey("boston", true));
    expect(JSON.stringify(set)).not.toContain(PRIVATE_PROSE);
    expect(JSON.stringify(set)).not.toContain(PRIVATE_PHOTO);
    expect(JSON.stringify(set)).not.toContain("homeData");

    const at = new Date(Date.now() - FURNISHED_TTL_MS + 60_000).toISOString();
    vi.mocked(readFurnished).mockResolvedValue({ at, set });
    const second = await (await search()).json();
    expect(second.cached).toBe(true);
    expect(second.asOf).toBe(at);
    expect(second.listings).toEqual(first.listings);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(writeFurnished).toHaveBeenCalledTimes(1);
    expect(commitLiveSearch).toHaveBeenCalledTimes(1);
  });

  it("does not store or charge a failed fallback as an empty market", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response("failed", { status: 500 }));
    const response = await search();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ live: false, reason: "http", status: 500 });
    expect(writeFurnished).not.toHaveBeenCalled();
    expect(commitLiveSearch).not.toHaveBeenCalled();
  });
});
