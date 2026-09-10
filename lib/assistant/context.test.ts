import { describe, expect, it } from "vitest";
import { MAX_ROWS, readContext, renderContext, suggestionsFor } from "./context";

const PROPERTY = {
  kind: "property",
  id: "property:live--jacksonville--rf-2262",
  address: "2262 Kingston St",
  city: "Jacksonville",
  stateCode: "fl",
  zip: "32209",
  bedrooms: 3,
  bathrooms: 1,
  propertyType: "House",
  rentMonthly: 979,
  rentSource: "listing",
  sourceUrl: "https://www.redfin.com/FL/Jacksonville/2262-Kingston-St-32209/home/1",
  point: { lat: 30.33, lon: -81.66 },
  market: { name: "Jacksonville", stateCode: "FL", regulation: { status: "permit-required", note: "Register with the city." } },
  figures: {
    adr: 157,
    occupancy: 0.45,
    comps: 25,
    measured: true,
    monthlyRevenue: 2148,
    netCashFlow: 568,
    breakeven: 0.31,
    cushionPts: 14,
    grade: "Good Deal",
  },
};

describe("reading what the page sent", () => {
  it("keeps a property as sent, with the state upper-cased", () => {
    const ctx = readContext(PROPERTY)!;
    expect(ctx.kind).toBe("property");
    if (ctx.kind !== "property") return;
    expect(ctx.stateCode).toBe("FL");
    expect(ctx.figures?.grade).toBe("Good Deal");
    expect(ctx.market.regulation?.status).toBe("permit-required");
    expect(ctx.point).toEqual({ lat: 30.33, lon: -81.66 });
  });

  it("refuses what is not a context, and drops what does not fit", () => {
    expect(readContext(null)).toBeNull();
    expect(readContext({ kind: "property" })).toBeNull();
    expect(readContext({ ...PROPERTY, rentMonthly: "979" })).toBeNull();
    expect(readContext({ ...PROPERTY, market: { name: "" } })).toBeNull();
    const loose = readContext({
      ...PROPERTY,
      sourceUrl: "javascript:alert(1)",
      zip: "3220",
      point: { lat: 91, lon: 0 },
      figures: { adr: "no" },
    })!;
    if (loose.kind !== "property") throw new Error("kind");
    expect(loose.sourceUrl).toBeUndefined();
    expect(loose.zip).toBeUndefined();
    expect(loose.point).toBeUndefined();
    expect(loose.figures).toBeUndefined();
  });

  it("caps a search at its first rows and keeps only whole ones", () => {
    const row = { address: "1 Main St", city: "Tampa", stateCode: "FL", bedrooms: 2, bathrooms: 1, rentMonthly: 1500 };
    const rows = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({ ...row, address: `${i + 1} Main St` }));
    const ctx = readContext({ kind: "search", id: "search:Tampa, FL", label: "Tampa, FL", market: null, total: 40, rows: [...rows, { address: "no size" }] })!;
    if (ctx.kind !== "search") throw new Error("kind");
    expect(ctx.rows).toHaveLength(MAX_ROWS);
    expect(ctx.total).toBe(40);
    expect(ctx.market).toBeNull();
  });

  it("bounds every string, so a body cannot smuggle a paragraph in", () => {
    expect(readContext({ ...PROPERTY, address: "x".repeat(201) })).toBeNull();
    const ctx = readContext({ ...PROPERTY, market: { ...PROPERTY.market, regulation: { status: "x", note: "n".repeat(401) } } })!;
    if (ctx.kind !== "property") throw new Error("kind");
    expect(ctx.market.regulation).toBeUndefined();
  });
});

describe("writing it for the model", () => {
  it("says what the page shows about a property, and where each figure stands", () => {
    const text = renderContext(readContext(PROPERTY)!);
    expect(text).toContain("2262 Kingston St, Jacksonville, FL 32209");
    expect(text).toContain("3 bd / 1 ba · House");
    expect(text).toContain("$979/mo (the listing's asking rent)");
    expect(text).toContain("measured from 25 comparable rentals nearby");
    expect(text).toContain("Nightly rate $157 · occupancy 45%");
    expect(text).toContain("net cash flow $568/mo");
    expect(text).toContain("Breakeven occupancy 31% · 14 pts of cushion");
    expect(text).toContain("Grade: Good Deal");
    expect(text).toContain("permit-required — Register with the city.");
    expect(text).toContain("Listing page already known: https://www.redfin.com/");
  });

  it("lists a search's rows with what is known about each", () => {
    const ctx = readContext({
      kind: "search",
      id: "search:ZIP 33604",
      label: "ZIP 33604",
      market: { name: "Tampa", stateCode: "FL" },
      total: 2,
      selected: "1804 E Sitka St",
      rows: [
        { address: "1804 E Sitka St", city: "Tampa", stateCode: "FL", zip: "33604", bedrooms: 2, bathrooms: 1, rentMonthly: 1450, net: 812, netRange: { low: 500, high: 1100 }, grade: "Good Deal Potential", analyzed: false },
        { address: "1 Other St", city: "Tampa", stateCode: "FL", bedrooms: 3, bathrooms: 2, rentMonthly: 2100, net: -120, netRange: null, grade: "Bad Deal", analyzed: true, sourceUrl: "https://www.redfin.com/FL/Tampa/1-Other-St-33604/home/2" },
      ],
    })!;
    const text = renderContext(ctx);
    expect(text).toContain("Search: ZIP 33604 · 2 rentals match, first 2 below");
    expect(text).toContain("Open on the map: 1804 E Sitka St");
    expect(text).toContain("1. 1804 E Sitka St, Tampa, FL 33604 · 2 bd / 1 ba · $1,450/mo · likely net $500 to $1,100/mo · Good Deal Potential");
    expect(text).toContain("2. 1 Other St, Tampa, FL · 3 bd / 2 ba · $2,100/mo · net $-120/mo (analyzed) · Bad Deal · page: https://www.redfin.com/");
  });

  it("opens with questions that fit what is in view", () => {
    expect(suggestionsFor(readContext(PROPERTY)!)[0]).toBe("Find the original listing for this rental");
    const search = readContext({ kind: "search", id: "s", label: "Tampa, FL", market: null, total: 0, rows: [], selected: "9 Elm St" })!;
    expect(suggestionsFor(search)).toContain("Find the original listing for 9 Elm St");
  });
});

describe("who to call, in the assistant's view of the page", () => {
  const contact = {
    name: "Jane Doe",
    company: "Riverside Realty",
    phone: "(904) 555-0142",
    role: "Listing agent",
  };

  it("is kept as the page shows it, and written for the model", () => {
    const ctx = readContext({ ...PROPERTY, contact })!;
    if (ctx.kind !== "property") throw new Error("expected a property");
    expect(ctx.contact).toEqual(contact);
    expect(renderContext(ctx)).toContain(
      "Listing agent on the listing: Jane Doe · Riverside Realty · (904) 555-0142"
    );
  });

  it("is nobody rather than an empty somebody", () => {
    const ctx = readContext({ ...PROPERTY, contact: { role: "Owner" } })!;
    if (ctx.kind !== "property") throw new Error("expected a property");
    expect(ctx.contact).toBeUndefined();
    expect(renderContext(ctx)).not.toContain("on the listing:");
  });
});
