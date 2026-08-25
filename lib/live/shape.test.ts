import { describe, expect, it } from "vitest";
import {
  amenityFields,
  arrayPaths,
  describeFields,
  describeShape,
  proseFields,
  statusStrings,
} from "./shape";

const PROSE =
  "Fully furnished 2 bedroom in Riverside with a fenced yard, washer " +
  "and dryer in unit, and a screened patio overlooking the water.";

describe("describeFields", () => {
  it("unions fields across ALL rows, not just the first", () => {
    // The exact false negative this replaced: a JSON feed omits null
    // fields per row, so a description carried by one listing in fifty
    // is invisible in row 0. Reading only row 0 answers "does this feed
    // carry descriptions?" with a confident, wrong no.
    const rows = [
      { id: "a", price: 2100 },
      { id: "b", price: 1850 },
      { id: "c", price: 2400, description: PROSE },
    ];
    const fields = describeFields(rows);
    expect(Object.keys(fields)).toContain("description");
    expect(proseFields(fields)).toEqual(["description"]);

    // Same sample through the single-row describer: no description.
    const firstRowOnly = describeShape(rows[0]) as Record<string, unknown>;
    expect(firstRowOnly.description).toBeUndefined();
  });

  it("counts only rows that actually carried a value", () => {
    const fields = describeFields([
      { id: "a", photos: null },
      { id: "b" },
      { id: "c", photos: ["x.jpg"] },
    ]);
    expect(fields.id.present).toBe(3);
    // null and absent both mean "this row told us nothing".
    expect(fields.photos.present).toBe(1);
  });

  it("records every type a field takes across the sample", () => {
    const fields = describeFields([{ bathrooms: 2 }, { bathrooms: "2.5" }]);
    expect(fields.bathrooms.types.sort()).toEqual(["number", "string"]);
  });

  it("flattens nested objects to dotted paths", () => {
    const fields = describeFields([
      { listingAgent: { name: "Dana Ruiz", phone: "904-555-0134" } },
    ]);
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining(["listingAgent.name", "listingAgent.phone"])
    );
  });

  it("reports arrays and walks their elements", () => {
    const fields = describeFields([{ amenities: ["Pool", "Garage"] }]);
    expect(fields.amenities.types).toContain("array");
    expect(fields["amenities[]"].types).toContain("string");
  });

  it("never carries a value through — only names, types, and lengths", () => {
    const fields = describeFields([{ description: PROSE }]);
    expect(JSON.stringify(fields)).not.toContain("furnished");
    expect(fields.description.maxLength).toBe(PROSE.length);
  });
});

describe("proseFields / amenityFields", () => {
  it("tells prose from a label by length", () => {
    const fields = describeFields([
      { description: PROSE, propertyType: "Single Family", city: "Jacksonville" },
    ]);
    expect(proseFields(fields)).toEqual(["description"]);
  });

  it("does not call a long URL prose", () => {
    // A thumbnail link clears the length bar and describes nothing.
    const fields = describeFields([
      { thumbnail_img_url: `https://ssl.cdn-redfin.com/${"a".repeat(90)}.jpg` },
    ]);
    expect(proseFields(fields)).toEqual([]);
  });

  it("catches amenity fields by NAME even when the values are short", () => {
    // A three-word `amenities` array is as good as prose for answering
    // "is it furnished", and would fall under the length threshold.
    const fields = describeFields([{ amenities: ["Furnished"] }]);
    expect(proseFields(fields)).toEqual([]);
    expect(amenityFields(fields)).toEqual(
      expect.arrayContaining(["amenities", "amenities[]"])
    );
  });

  it("finds nothing to mine in a payload with no descriptive text", () => {
    const fields = describeFields([
      { id: "a", price: 2100, bedrooms: 2, city: "Jacksonville" },
    ]);
    expect(proseFields(fields)).toEqual([]);
    expect(amenityFields(fields)).toEqual([]);
  });
});

describe("arrayPaths", () => {
  it("names where the records are, without knowing the schema", () => {
    // The question a probe has to answer when extraction finds nothing:
    // an empty result told us nothing about the payload that produced it.
    const body = { data: { homes: [{ a: 1 }, { a: 2 }], total: 2 } };
    expect(arrayPaths(body)).toContainEqual({ path: "data.homes", length: 2 });
  });

  it("reports a bare array at the root", () => {
    expect(arrayPaths([1, 2, 3])[0]).toEqual({ path: "(root)", length: 3 });
  });

  it("reports empty arrays too — an empty container is an answer", () => {
    expect(arrayPaths({ homes: [] })).toContainEqual({
      path: "homes",
      length: 0,
    });
  });

  it("finds nothing in a payload with no arrays", () => {
    expect(arrayPaths({ error: "nope" })).toEqual([]);
  });
});

describe("statusStrings", () => {
  it("surfaces a vendor explaining itself", () => {
    expect(
      statusStrings({ error: "Invalid search URL", homes: [] })
    ).toEqual({ error: "Invalid search URL" });
  });

  it("ignores ordinary content, however long", () => {
    // Only status-ish keys, so record values never ride along.
    expect(statusStrings({ address: "1204 Glencoe St", price: 1850 })).toEqual(
      {}
    );
  });
});
