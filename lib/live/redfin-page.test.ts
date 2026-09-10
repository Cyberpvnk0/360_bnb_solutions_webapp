import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractAddressRows,
  parsePropertyPath,
  pickAddressRow,
  resolveListingPage,
} from "./redfin-page";
import { addressKey } from "./address";
import { fetchAutocomplete } from "./redfin-city";
import { searchListingPages } from "./page-search";
import { readZipPages, type ZipPages } from "./zip-pages";
import { indexBySite } from "./listing-join";
import { lookupZipAt } from "@/lib/map/zip-boundary";
import { readKeyedBlob, writeKeyed } from "@/lib/db/market-store";

vi.mock("./redfin-city", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./redfin-city")>()),
  fetchAutocomplete: vi.fn(),
}));
vi.mock("./page-search", () => ({
  searchListingPages: vi.fn(async () => ({ urls: [], detail: "bing: HTTP 403; duckduckgo: HTTP 403" })),
}));
vi.mock("./zip-pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./zip-pages")>()),
  readZipPages: vi.fn(),
}));
vi.mock("@/lib/map/zip-boundary", () => ({
  lookupZipAt: vi.fn(),
}));
vi.mock("@/lib/db/market-store", () => ({
  isFresh: () => true,
  readKeyedBlob: vi.fn(),
  writeKeyed: vi.fn(),
}));

/** What the engines say when neither will talk to a server. */
const NO_ENGINES = { urls: [], detail: "bing: HTTP 403; duckduckgo: HTTP 403" };

beforeEach(() => {
  vi.mocked(searchListingPages).mockReset();
  vi.mocked(searchListingPages).mockResolvedValue(NO_ENGINES);
  vi.mocked(writeKeyed).mockReset();
  vi.mocked(writeKeyed).mockResolvedValue(undefined as never);
});

/** A ZIP's rows as lib/live/zip-pages hands them back. */
function zipPages(
  rows: { address: string; sourceUrl: string }[],
  complete = true
): { ok: true; pages: ZipPages } {
  return {
    ok: true,
    pages: { zip: "33604", index: indexBySite(rows), rows: rows.length, pages: 1, complete, from: "site" },
  };
}

const PAYLOAD = {
  payload: {
    sections: [
      {
        rows: [
          // The lookup prints the street and the town in separate fields.
          { id: "1_47311661", name: "1804 E Sitka St", subName: "Tampa, FL 33604", url: "/FL/Tampa/1804-E-Sitka-St-33604/home/47311661", type: "1" },
          { id: "2_1", name: "Sitka", url: "/neighborhood/1/FL/Tampa/Sitka", type: "2" },
          { id: "1_99", name: "1804 E Sitka St Unit 2", subName: "Tampa, FL 33604", url: "/FL/Tampa/1804-E-Sitka-St-33604/unit-2/home/99?x=1", type: "1" },
        ],
      },
    ],
  },
};
const TAMPA = { address: "1804 E Sitka St", city: "Tampa", stateCode: "FL" };

describe("property rows in the portal's address lookup", () => {
  it("keeps the rows that are property pages and nothing else", () => {
    const rows = extractAddressRows(PAYLOAD);
    expect(rows.map((r) => r.url)).toEqual([
      "/FL/Tampa/1804-E-Sitka-St-33604/home/47311661",
      "/FL/Tampa/1804-E-Sitka-St-33604/unit-2/home/99?x=1",
    ]);
  });

  it("survives shapes it has never seen", () => {
    expect(extractAddressRows(null)).toEqual([]);
    expect(extractAddressRows({ error: "nope" })).toEqual([]);
    expect(extractAddressRows([{ url: 12, name: "x" }])).toEqual([]);
  });
});

describe("picking the page for exactly this address", () => {
  const rows = extractAddressRows(PAYLOAD);

  it("takes the row whose street keys the same and whose town and state match", () => {
    expect(pickAddressRow(rows, TAMPA)).toBe(
      "https://www.redfin.com/FL/Tampa/1804-E-Sitka-St-33604/home/47311661"
    );
    // "Street" against "St" is the same address.
    expect(pickAddressRow(rows, { ...TAMPA, address: "1804 East Sitka Street" })).toBe(
      "https://www.redfin.com/FL/Tampa/1804-E-Sitka-St-33604/home/47311661"
    );
  });

  it("keeps units apart, and drops a query string from the page", () => {
    expect(pickAddressRow(rows, { ...TAMPA, address: "1804 E Sitka St Unit 2" })).toBe(
      "https://www.redfin.com/FL/Tampa/1804-E-Sitka-St-33604/unit-2/home/99"
    );
    expect(pickAddressRow(rows, { ...TAMPA, address: "1804 E Sitka St Apt 3" })).toBeNull();
  });

  it("refuses a row in another town or another state", () => {
    expect(pickAddressRow(rows, { ...TAMPA, city: "Orlando" })).toBeNull();
    expect(pickAddressRow(rows, { ...TAMPA, stateCode: "GA" })).toBeNull();
  });

  it("lets the ZIP vouch for a town the feed names differently", () => {
    // A suburb listed under the market's name: the path says Tampa,
    // the row says the market, and the ZIP settles it.
    expect(pickAddressRow(rows, { ...TAMPA, city: "Tampa Bay Area", zip: "33604" })).toBe(
      "https://www.redfin.com/FL/Tampa/1804-E-Sitka-St-33604/home/47311661"
    );
    expect(pickAddressRow(rows, { ...TAMPA, city: "Tampa Bay Area", zip: "33605" })).toBeNull();
  });

  it("matches on the page's path even when the row prints nothing useful", () => {
    const bare = [{ name: "", url: "/FL/Tampa/1804-E-Sitka-St-33604/home/47311661" }];
    expect(pickAddressRow(bare, TAMPA)).toBe(
      "https://www.redfin.com/FL/Tampa/1804-E-Sitka-St-33604/home/47311661"
    );
  });

  it("has nothing for an address it cannot key", () => {
    expect(pickAddressRow(rows, { ...TAMPA, address: "" })).toBeNull();
  });
});

describe("what a property page's path says", () => {
  it("reads the state, town, street, ZIP and unit out of it", () => {
    expect(parsePropertyPath("/FL/Tampa/1804-E-Sitka-St-33604/unit-2/home/99?x=1")).toEqual({
      state: "FL",
      city: "Tampa",
      street: "1804 E Sitka St",
      zip: "33604",
      unit: "2",
    });
    expect(parsePropertyPath("/FL/St-Petersburg/100-Main-St/home/5")).toEqual({
      state: "FL",
      city: "St Petersburg",
      street: "100 Main St",
      zip: null,
      unit: null,
    });
    expect(parsePropertyPath("/neighborhood/1/FL/Tampa/Sitka")).toBeNull();
  });
});

describe("resolving a page from an address", () => {
  const lookup = vi.mocked(fetchAutocomplete);
  const zipSearch = vi.mocked(readZipPages);
  const zipAt = vi.mocked(lookupZipAt);
  const stored = vi.mocked(readKeyedBlob);
  const remember = vi.mocked(writeKeyed);
  beforeEach(() => {
    vi.stubEnv("SCRAPERAPI_KEY", "k");
    stored.mockResolvedValue(null);
    remember.mockResolvedValue(undefined as never);
    zipSearch.mockResolvedValue({ ok: false, detail: "rentals: http 500: Failed to scrape" });
    zipAt.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("takes the page from the ZIP's rentals, and never asks the slow lookup", async () => {
    zipSearch.mockResolvedValue(
      zipPages([{ address: "1804 E Sitka St", sourceUrl: "https://www.redfin.com/FL/Tampa/1804-E-Sitka-St-33604/home/47311661" }])
    );
    const r = await resolveListingPage({ ...TAMPA, address: "1804 East Sitka Street", zip: "33604" });
    expect(zipSearch).toHaveBeenCalledWith("33604");
    expect(r).toEqual({
      url: "https://www.redfin.com/FL/Tampa/1804-E-Sitka-St-33604/home/47311661",
      answered: true,
      detail: null,
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(remember).toHaveBeenCalledWith(`page:v2:fl:${addressKey("1804 E Sitka St")}`, {
      url: "https://www.redfin.com/FL/Tampa/1804-E-Sitka-St-33604/home/47311661",
    });
  });

  it("reads the ZIP off the address line, or finds it under the point", async () => {
    zipSearch.mockResolvedValue(zipPages([]));
    await resolveListingPage({ ...TAMPA, address: "1804 E Sitka St, Tampa, FL 33604" });
    expect(zipSearch).toHaveBeenLastCalledWith("33604");
    zipAt.mockResolvedValue("33605");
    await resolveListingPage({ ...TAMPA, address: "1810 E Sitka St", point: { lat: 27.99, lon: -82.44 } });
    expect(zipAt).toHaveBeenCalledWith({ lat: 27.99, lon: -82.44 });
    expect(zipSearch).toHaveBeenLastCalledWith("33605");
  });

  it("calls a ZIP read whole with no such address a miss, and remembers it", async () => {
    zipSearch.mockResolvedValue(zipPages([{ address: "1 Other St", sourceUrl: "https://www.redfin.com/x/home/1" }], true));
    const r = await resolveListingPage({ ...TAMPA, zip: "33604" });
    expect(r.url).toBeNull();
    expect(r.answered).toBe(true);
    expect(r.detail).toMatch(/1 rental in 33604, none at this address/);
    expect(lookup).not.toHaveBeenCalled();
    expect(remember).toHaveBeenCalledWith(`page:v2:fl:${addressKey(TAMPA.address)}`, { url: null });
  });

  it("falls through to the lookup when the ZIP was read in part", async () => {
    zipSearch.mockResolvedValue(zipPages([], false));
    lookup.mockResolvedValue({
      attempt: { tier: "premium", status: 200, text: "" },
      body: PAYLOAD,
      tried: ["premium"],
    });
    const r = await resolveListingPage({ ...TAMPA, zip: "33604" });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(r.url).toMatch(/47311661$/);
  });

  it("says the portal never answered, and remembers nothing", async () => {
    // The Deal Finder's own failure: both tiers cut off by the clock.
    // That is "try again", not "not here" — so it must not be stored
    // as a miss, and the panel must not say the property isn't listed.
    lookup.mockResolvedValue({
      attempt: { tier: "premium", status: 408, text: "no answer in 50s" },
      body: null,
      tried: ["premium"],
    });
    const r = await resolveListingPage(TAMPA);
    expect(r.url).toBeNull();
    expect(r.answered).toBe(false);
    expect(r.detail).toBe(
      "no ZIP to search; engines: bing: HTTP 403; duckduckgo: HTTP 403; lookup did not answer (no answer in 50s on premium)"
    );
    expect(remember).not.toHaveBeenCalled();
  });

  it("finds the page and remembers it", async () => {
    lookup.mockResolvedValue({
      attempt: { tier: "premium", status: 200, text: "" },
      body: PAYLOAD,
      tried: ["premium"],
    });
    const r = await resolveListingPage(TAMPA);
    expect(r).toEqual({
      url: "https://www.redfin.com/FL/Tampa/1804-E-Sitka-St-33604/home/47311661",
      answered: true,
      detail: null,
    });
    expect(remember).toHaveBeenCalledWith(
      `page:v2:fl:${addressKey("1804 E Sitka St")}`,
      { url: "https://www.redfin.com/FL/Tampa/1804-E-Sitka-St-33604/home/47311661" }
    );
    // Its own budget, wider than a city lookup's.
    expect(lookup).toHaveBeenCalledWith(expect.any(String), "k", { budgetMs: 50_000 });
  });

  it("remembers a real miss as one", async () => {
    lookup.mockResolvedValue({
      attempt: { tier: "premium", status: 200, text: "" },
      body: PAYLOAD,
      tried: ["premium"],
    });
    const r = await resolveListingPage({ ...TAMPA, address: "1806 E Sitka St" });
    expect(r.url).toBeNull();
    expect(r.answered).toBe(true);
    expect(r.detail).toMatch(/answered with 2 property pages, none for this address/);
    expect(remember).toHaveBeenCalledWith(
      `page:v2:fl:${addressKey("1806 E Sitka St")}`,
      { url: null }
    );
  });

  it("asks once for two callers in the same moment", async () => {
    // The analyzer's link, its finder page and the contact panel can
    // all ask about one address inside the same half-minute; each
    // would be its own billed request.
    let release: (v: unknown) => void = () => {};
    lookup.mockReturnValue(
      new Promise((r) => {
        release = r;
      }) as never
    );
    const first = resolveListingPage(TAMPA);
    const second = resolveListingPage(TAMPA);
    await Promise.resolve();
    release({
      attempt: { tier: "premium", status: 200, text: "" },
      body: PAYLOAD,
      tried: ["premium"],
    });
    const [a, b] = await Promise.all([first, second]);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(a.url).toBe(b.url);
    expect(a.url).toMatch(/47311661$/);
  });

  it("serves a remembered answer without asking again", async () => {
    stored.mockResolvedValue({
      value: { url: null },
      at: new Date().toISOString(),
    } as never);
    const r = await resolveListingPage(TAMPA);
    expect(r.answered).toBe(true);
    expect(r.detail).toMatch(/remembered/);
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("the engines' index of the site, asked alongside the ZIP", () => {
  const read = vi.mocked(readZipPages);
  const lookup = vi.mocked(fetchAutocomplete);
  const engines = vi.mocked(searchListingPages);
  const store = vi.mocked(readKeyedBlob);
  const remember = vi.mocked(writeKeyed);
  beforeEach(() => {
    read.mockReset();
    lookup.mockReset();
    store.mockReset();
    store.mockResolvedValue(null);
    read.mockResolvedValue(zipPages([], false));
    vi.stubEnv("SCRAPERAPI_KEY", "k");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("takes the engines' page when its path spells exactly this address, and remembers it", async () => {
    engines.mockResolvedValue({
      urls: [
        "https://www.redfin.com/FL/Tampa/1806-E-Sitka-St-33604/home/5",
        "https://www.redfin.com/FL/Tampa/1804-E-Sitka-St-33604/home/47311661",
      ],
      detail: "bing: 2 pages",
    });
    const out = await resolveListingPage({ ...TAMPA, address: "1804 East Sitka Street", zip: "33604" });
    expect(out).toEqual({ url: "https://www.redfin.com/FL/Tampa/1804-E-Sitka-St-33604/home/47311661", answered: true, detail: null });
    expect(lookup).not.toHaveBeenCalled();
    expect(remember).toHaveBeenCalledWith(expect.any(String), {
      url: "https://www.redfin.com/FL/Tampa/1804-E-Sitka-St-33604/home/47311661",
    });
  });

  it("refuses a near miss from the engines, and goes on to the slow lookup", async () => {
    engines.mockResolvedValue({
      urls: ["https://www.redfin.com/FL/Tampa/1804-E-Sitka-St-33604/unit-2/home/99", "https://www.redfin.com/FL/Orlando/1804-E-Sitka-St-32801/home/7"],
      detail: "bing: 2 pages",
    });
    lookup.mockResolvedValue({ attempt: { tier: "premium", status: 408, text: "no answer in 50s" }, body: null, tried: ["premium"] });
    const out = await resolveListingPage({ ...TAMPA, zip: "33604" });
    expect(out.url).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(out.detail).toContain("engines: bing: 2 pages");
  });

  it("reads a rental's own page shape too", async () => {
    engines.mockResolvedValue({
      urls: ["https://www.redfin.com/FL/Tampa/1107-W-Arch-St-33607/unit-A/apartment/171893443"],
      detail: "bing: 1 page",
    });
    const out = await resolveListingPage({ address: "1107 W Arch St Apt A", city: "Tampa", stateCode: "FL", zip: "33607" }, { fast: true });
    expect(out.url).toBe("https://www.redfin.com/FL/Tampa/1107-W-Arch-St-33607/unit-A/apartment/171893443");
  });
});

describe("the fast resolution, for a click that must move on", () => {
  const read = vi.mocked(readZipPages);
  const lookup = vi.mocked(fetchAutocomplete);
  const store = vi.mocked(readKeyedBlob);
  beforeEach(() => {
    read.mockReset();
    lookup.mockReset();
    store.mockReset();
    store.mockResolvedValue(null);
  });

  it("reads the ZIP's rentals and never starts the slow lookup", async () => {
    read.mockResolvedValue(zipPages([], false));
    const out = await resolveListingPage({ ...TAMPA, zip: "33604" }, { fast: true });
    expect(out.url).toBeNull();
    expect(out.answered).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("still takes the page when the ZIP has it, and a whole-ZIP miss as a miss", async () => {
    read.mockResolvedValue(zipPages([{ address: "1804 E Sitka St", sourceUrl: "https://www.redfin.com/FL/Tampa/x/home/1" }]));
    expect((await resolveListingPage({ ...TAMPA, zip: "33604" }, { fast: true })).url).toBe(
      "https://www.redfin.com/FL/Tampa/x/home/1"
    );
    read.mockResolvedValue(zipPages([{ address: "1 Other St", sourceUrl: "https://www.redfin.com/FL/Tampa/o/home/2" }], true));
    const miss = await resolveListingPage({ ...TAMPA, address: "1806 E Sitka St", zip: "33604" }, { fast: true });
    expect(miss).toMatchObject({ url: null, answered: true });
  });

  it("moves on when the ZIP is still being read past its budget", async () => {
    read.mockReturnValue(new Promise(() => undefined));
    const out = await resolveListingPage({ ...TAMPA, address: "1808 E Sitka St", zip: "33604" }, { fast: true, fastBudgetMs: 10 });
    expect(out).toMatchObject({ url: null, answered: false });
    expect(out.detail).toContain("still being read");
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("what a failed ZIP read leaves in the answer", () => {
  it("names the ZIP and what the site said, before the lookup's own verdict", async () => {
    vi.stubEnv("SCRAPERAPI_KEY", "k");
    vi.mocked(readKeyedBlob).mockResolvedValue(null);
    vi.mocked(readZipPages).mockResolvedValue({ ok: false, detail: "rentals: quota 429: too many" });
    vi.mocked(fetchAutocomplete).mockResolvedValue({
      attempt: { tier: "premium", status: 408, text: "no answer in 50s" },
      body: null,
      tried: ["premium"],
    });
    const r = await resolveListingPage({ ...TAMPA, zip: "33604" });
    expect(r.answered).toBe(false);
    expect(r.detail).toBe(
      "33604: rentals: quota 429: too many; engines: bing: HTTP 403; duckduckgo: HTTP 403; lookup did not answer (no answer in 50s on premium)"
    );
    vi.unstubAllEnvs();
  });
});
