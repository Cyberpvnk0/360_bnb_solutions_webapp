import { describe, expect, it } from "vitest";
import { extractAddressRows, parsePropertyPath, pickAddressRow } from "./redfin-page";

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
