import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRedfinRentals, looksUpstream, RedfinError } from "@/lib/live/redfin";
import type { Market } from "@/lib/mock/types";

/**
 * The furnished search's failure paths, driven against a fake supplier.
 *
 * The case that started this: Bailey, Colorado — seven hundred people,
 * no Redfin rentals page — answered a furnished search with a 500 and
 * the screen called it an outage. Jacksonville, asked the same way in
 * the same minute, was fine. So the endpoint works and small towns
 * simply have nothing, and "nothing" has to read as an answer.
 *
 * The line these tests defend is the one between "this town has none"
 * and "we are broken", because getting it wrong in the generous
 * direction means telling every member there is no inventory anywhere.
 *
 * WHICH IS WHAT HAPPENED. The first cut concluded "none" whenever the
 * bare city URL worked, on the reasoning that a working city means the
 * filter is simply empty. It does not: a valid filter on a working
 * page answers 200 and empty, never 404. Boston — hundreds of
 * furnished rentals listed — read "the feed carries no furnished units
 * here today". Only a city with NO page, or a page with no rentals on
 * it at all, concludes "none" now.
 */

const BAILEY = {
  slug: "bailey",
  name: "Bailey",
  stateCode: "CO",
  state: "Colorado",
  lat: 39.41,
  lon: -105.48,
} as unknown as Market;

const real = globalThis.fetch;
const realKey = process.env.SCRAPERAPI_KEY;

// Without a key every call short-circuits to `no-key` before it ever
// reaches the supplier, and every assertion below is about what the
// supplier said.
beforeEach(() => {
  process.env.SCRAPERAPI_KEY = "test";
});

afterEach(() => {
  globalThis.fetch = real;
  if (realKey === undefined) delete process.env.SCRAPERAPI_KEY;
  else process.env.SCRAPERAPI_KEY = realKey;
  vi.restoreAllMocks();
});

/** A supplier that answers each target URL however the table says. */
function vendor(
  table: (target: string) => { status: number; body?: unknown; text?: string }
) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const target = new URL(String(input)).searchParams.get("url") ?? String(input);
    const { status, body, text } = table(target);
    if (status === 200) {
      return new Response(JSON.stringify(body ?? {}), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(text ?? "<html>gone</html>", { status });
  }) as typeof fetch;
}

const furnishedUrl = (t: string) => t.includes("is-furnished");

/** One row, in the shape the extractor reads. */
const ROWS = { listings: [{ streetLine: "1 Main St, Bailey, CO", price: 2000 }] };

/** Verbatim, from the live failure this was reported with. */
const UPSTREAM_500 = JSON.stringify({
  error:
    "Request failed. You will not be charged for this request. Please make sure your url is correct and try again. Protected domains may require adding premium=true OR ultra_premium=true",
});

/** A 500 that is the supplier's own trouble — none of that wording. */
const SUPPLIER_500 = JSON.stringify({ error: "Internal server error" });

const ask = (opts: Record<string, unknown>) =>
  fetchRedfinRentals(BAILEY, { map: false, ...opts });

/* ------------------------------------------------------------------ */

describe("reading the supplier's 500", () => {
  it("recognises an upstream fetch failure by its own wording", () => {
    expect(looksUpstream(UPSTREAM_500)).toBe(true);
    expect(looksUpstream("You will not be charged for this request")).toBe(true);
    expect(looksUpstream("Please make sure your url is correct")).toBe(true);
  });

  it("does not mistake the supplier's own failure for one", () => {
    expect(looksUpstream(SUPPLIER_500)).toBe(false);
    expect(looksUpstream("502 Bad Gateway")).toBe(false);
    expect(looksUpstream("")).toBe(false);
  });
});

/**
 * 404 and 410 are the site saying "no such page", which stands on the
 * status alone. A 500 has to carry the wording as well — see below.
 */
describe.each([404, 410])("a filtered search that fails with %i", (status) => {
  /**
   * The line that read the other way round, and cost Boston.
   *
   * A valid filter on a working city page answers 200 with an empty
   * result set. It does not answer 404. So a filtered URL that errors
   * while the bare one serves rows is a broken URL, not an empty
   * market — and "no furnished rentals listed in Boston" is a
   * confident, specific, wrong answer in the one place a member
   * decides whether a market is worth working.
   */
  it("REPORTS it when the city itself serves rows — the URL is what is wrong", async () => {
    vendor((t) => (furnishedUrl(t) ? { status } : { status: 200, body: ROWS }));
    await expect(ask({ furnished: true })).rejects.toMatchObject({
      reason: "http",
      status,
    });
  }, 20_000);

  it("says NONE when the city answers but carries no rentals", async () => {
    vendor((t) =>
      furnishedUrl(t) ? { status } : { status: 200, body: { listings: [] } }
    );
    await expect(ask({ furnished: true })).resolves.toMatchObject({ listings: [] });
  }, 20_000);

  it("says NONE when the city has no page either", async () => {
    vendor(() => ({ status }));
    await expect(ask({ furnished: true })).resolves.toMatchObject({ listings: [] });
  }, 20_000);

  it("REPORTS it when the city is throttled — that says nothing about the filter", async () => {
    vendor((t) => (furnishedUrl(t) ? { status } : { status: 429, text: "slow down" }));
    await expect(ask({ furnished: true })).rejects.toMatchObject({
      reason: "http",
      status,
    });
  }, 25_000);

  it("REPORTS it on an UNFILTERED search — there is nothing to reinterpret", async () => {
    vendor(() => ({ status }));
    await expect(ask({})).rejects.toMatchObject({ reason: "http", status });
  }, 20_000);
});

describe("a 500, where the wording decides", () => {
  it("says NONE when both searches fail the way a missing page does", async () => {
    // The Bailey case exactly: no rentals page, so neither URL resolves.
    vendor(() => ({ status: 500, text: UPSTREAM_500 }));
    await expect(ask({ furnished: true })).resolves.toMatchObject({ listings: [] });
  }, 25_000);

  it("REPORTS it when the city is there and serving rows", async () => {
    // Same reasoning as the 404 case: a working city page plus a
    // failing filtered URL is a URL problem, and an entire metro
    // reading "none" is the worst possible way to present one.
    vendor((t) =>
      furnishedUrl(t) ? { status: 500, text: UPSTREAM_500 } : { status: 200, body: ROWS }
    );
    await expect(ask({ furnished: true })).rejects.toMatchObject({
      reason: "http",
      status: 500,
    });
  }, 25_000);

  it("says NONE when the city answers with no rentals at all", async () => {
    // A city with a page and nothing on it has no furnished units
    // either. This is the branch that still concludes "none".
    vendor((t) =>
      furnishedUrl(t)
        ? { status: 500, text: UPSTREAM_500 }
        : { status: 200, body: { listings: [] } }
    );
    await expect(ask({ furnished: true })).resolves.toMatchObject({ listings: [] });
  }, 25_000);

  it("REPORTS the supplier's own 500 — no wording, no conclusion", async () => {
    vendor(() => ({ status: 500, text: SUPPLIER_500 }));
    await expect(ask({ furnished: true })).rejects.toMatchObject({
      reason: "http",
      status: 500,
    });
  }, 25_000);

  it("REPORTS it when the filter fails upstream but the city is throttled", async () => {
    vendor((t) =>
      furnishedUrl(t) ? { status: 500, text: UPSTREAM_500 } : { status: 429, text: "slow" }
    );
    await expect(ask({ furnished: true })).rejects.toMatchObject({
      reason: "http",
      status: 500,
    });
  }, 30_000);

  it("REPORTS it on an UNFILTERED search", async () => {
    vendor(() => ({ status: 500, text: UPSTREAM_500 }));
    await expect(ask({})).rejects.toMatchObject({ reason: "http", status: 500 });
  }, 25_000);
});

describe("the opening page gets one retry on a 5xx", () => {
  it("succeeds on the second attempt rather than failing the search", async () => {
    let seen = 0;
    globalThis.fetch = vi.fn(async () => {
      seen += 1;
      return seen === 1
        ? new Response(SUPPLIER_500, { status: 500 })
        : new Response(JSON.stringify(ROWS), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    }) as typeof fetch;
    const out = await ask({ furnished: true });
    expect(out.raw).toHaveLength(1);
    expect(seen).toBeGreaterThanOrEqual(2);
  }, 20_000);
});

describe("a supplier that never answers", () => {
  it("is a timeout, not a network failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      const e = new Error("aborted due to timeout");
      e.name = "TimeoutError";
      throw e;
    }) as typeof fetch;
    const err = await ask({ furnished: true }).catch((e) => e);
    expect(err).toBeInstanceOf(RedfinError);
    expect(err.reason).toBe("timeout");
  });

  it("is a network failure when the connection genuinely fails", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const err = await ask({ furnished: true }).catch((e) => e);
    expect(err.reason).toBe("network");
  });
});
