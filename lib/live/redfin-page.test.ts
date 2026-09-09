import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractAddressRows,
  parsePropertyPath,
  pickAddressRow,
  resolveListingPage,
} from "./redfin-page";
import { addressKey } from "./address";
import { fetchAutocomplete } from "./redfin-city";
import { readKeyedBlob, writeKeyed } from "@/lib/db/market-store";

vi.mock("./redfin-city", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./redfin-city")>()),
  fetchAutocomplete: vi.fn(),
}));
vi.mock("@/lib/db/market-store", () => ({
  isFresh: () => true,
  readKeyedBlob: vi.fn(),
  writeKeyed: vi.fn(),
}));

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
  const stored = vi.mocked(readKeyedBlob);
  const remember = vi.mocked(writeKeyed);
  beforeEach(() => {
    vi.stubEnv("SCRAPERAPI_KEY", "k");
    stored.mockResolvedValue(null);
    remember.mockResolvedValue(undefined as never);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
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
    expect(r.detail).toBe("lookup did not answer (no answer in 50s on premium)");
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
