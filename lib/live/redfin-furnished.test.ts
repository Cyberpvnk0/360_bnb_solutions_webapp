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

describe("a filtered page that 404s", () => {
  it("is an EMPTY furnished set when the city itself is fine", async () => {
    process.env.SCRAPERAPI_KEY = "test";
    vendor((target) =>
      target.includes("is-furnished")
        ? { status: 404 }
        : { status: 200, body: { listings: [] } }
    );
    const out = await fetchRedfinRentals(BAILEY, { furnished: true, map: false });
    expect(out.listings).toEqual([]);
    expect(out.raw).toEqual([]);
  });

  it("is still an ERROR when the city 404s too", async () => {
    process.env.SCRAPERAPI_KEY = "test";
    vendor(() => ({ status: 404 }));
    await expect(fetchRedfinRentals(BAILEY, { furnished: true, map: false }))
      .rejects.toMatchObject({ reason: "http", status: 404 });
  });

  it("is untouched for an UNFILTERED search — nothing to reinterpret", async () => {
    process.env.SCRAPERAPI_KEY = "test";
    vendor(() => ({ status: 404 }));
    await expect(fetchRedfinRentals(BAILEY, { map: false }))
      .rejects.toMatchObject({ reason: "http", status: 404 });
  });
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
