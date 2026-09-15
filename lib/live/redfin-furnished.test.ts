import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRedfinRentals, RedfinError } from "@/lib/live/redfin";
import type { Market } from "@/lib/mock/types";

const BAILEY = {
  slug: "bailey", name: "Bailey", stateCode: "CO", state: "Colorado",
  lat: 39.41, lon: -105.48,
} as unknown as Market;

const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; vi.restoreAllMocks(); });

/** A vendor that answers each URL however the table says. */
function vendor(table: (target: string) => { status: number; body?: unknown }) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const target = url.searchParams.get("url") ?? String(input);
    const { status, body } = table(target);
    return new Response(status === 200 ? JSON.stringify(body ?? {}) : "<html>gone</html>", {
      status, headers: { "content-type": status === 200 ? "application/json" : "text/html" },
    });
  }) as typeof fetch;
}

/** One row, in the shape the extractor reads. */
const ROWS = { listings: [{ streetLine: "1 Main St, Bailey, CO", price: 2000 }] };

describe.each([404, 410, 500])("a filtered search that fails with %i", (status) => {
  it("is an EMPTY furnished set when the same city returns rows unfiltered", async () => {
    process.env.SCRAPERAPI_KEY = "test";
    vendor((target) =>
      target.includes("is-furnished") ? { status } : { status: 200, body: ROWS }
    );
    const out = await fetchRedfinRentals(BAILEY, { furnished: true, map: false });
    expect(out.listings).toEqual([]);
    expect(out.raw).toEqual([]);
  }, 20_000);

  it("is still an ERROR when the city fails too", async () => {
    process.env.SCRAPERAPI_KEY = "test";
    vendor(() => ({ status }));
    await expect(
      fetchRedfinRentals(BAILEY, { furnished: true, map: false })
    ).rejects.toMatchObject({ reason: "http", status });
  }, 20_000);

  it("is still an ERROR when the city answers but carries NO rows", async () => {
    // Up, and empty-handed. That proves the endpoint is alive and
    // nothing at all about the filter — so reporting "no furnished
    // rentals here" would be inventing a fact.
    process.env.SCRAPERAPI_KEY = "test";
    vendor((target) =>
      target.includes("is-furnished") ? { status } : { status: 200, body: { listings: [] } }
    );
    await expect(
      fetchRedfinRentals(BAILEY, { furnished: true, map: false })
    ).rejects.toMatchObject({ reason: "http", status });
  }, 20_000);

  it("is untouched for an UNFILTERED search — nothing to reinterpret", async () => {
    process.env.SCRAPERAPI_KEY = "test";
    vendor(() => ({ status }));
    await expect(
      fetchRedfinRentals(BAILEY, { map: false })
    ).rejects.toMatchObject({ reason: "http", status });
  }, 20_000);
});

describe("the opening page gets one retry on a 5xx", () => {
  it("succeeds on the second attempt rather than failing the search", async () => {
    process.env.SCRAPERAPI_KEY = "test";
    let seen = 0;
    globalThis.fetch = vi.fn(async () => {
      seen += 1;
      return seen === 1
        ? new Response("<html>oops</html>", { status: 500 })
        : new Response(JSON.stringify(ROWS), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    }) as typeof fetch;
    const out = await fetchRedfinRentals(BAILEY, { furnished: true, map: false });
    expect(out.raw).toHaveLength(1);
    expect(seen).toBeGreaterThanOrEqual(2);
  }, 15_000);
});

describe("a vendor that never answers", () => {
  it("is a timeout, not a network failure", async () => {
    process.env.SCRAPERAPI_KEY = "test";
    globalThis.fetch = vi.fn(async () => {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      throw e;
    }) as typeof fetch;
    const err = await fetchRedfinRentals(BAILEY, { furnished: true, map: false })
      .catch((e) => e);
    expect(err).toBeInstanceOf(RedfinError);
    expect(err.reason).toBe("timeout");
  });

  it("is a network failure when the connection genuinely fails", async () => {
    process.env.SCRAPERAPI_KEY = "test";
    globalThis.fetch = vi.fn(async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    const err = await fetchRedfinRentals(BAILEY, { furnished: true, map: false })
      .catch((e) => e);
    expect(err.reason).toBe("network");
  });
});
