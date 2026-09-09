import { describe, expect, it } from "vitest";
import { extractAddressRows, pickAddressRow } from "./redfin-page";

const PAYLOAD = {
  payload: {
    sections: [
      {
        rows: [
          { id: "1_47311661", name: "1804 E Sitka St, Tampa, FL 33604", url: "/FL/Tampa/1804-E-Sitka-St-33604/home/47311661", type: "1" },
          { id: "2_1", name: "Sitka", url: "/neighborhood/1/FL/Tampa/Sitka", type: "2" },
          { id: "1_99", name: "1804 E Sitka St Unit 2, Tampa, FL 33604", url: "/FL/Tampa/1804-E-Sitka-St-33604/unit-2/home/99?x=1", type: "1" },
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

  it("has nothing for an address it cannot key", () => {
    expect(pickAddressRow(rows, { ...TAMPA, address: "" })).toBeNull();
  });
});
