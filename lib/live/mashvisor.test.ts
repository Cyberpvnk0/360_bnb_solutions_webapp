import { describe, expect, it } from "vitest";
import { idFieldsIn, imageFieldsIn } from "./mashvisor";

describe("finding pictures in a payload nobody has mapped yet", () => {
  it("collapses a row's photo array into one finding, not forty", () => {
    const payload = {
      content: {
        properties: [
          {
            id: 1,
            photos: [
              "https://cdn.example.com/a.jpg",
              "https://cdn.example.com/b.jpg",
              "https://cdn.example.com/c.jpg",
            ],
          },
        ],
      },
    };
    const found = imageFieldsIn(payload);
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe("content.properties[].photos[]");
    expect(found[0].count).toBe(3);
    expect(found[0].sample).toBe("https://cdn.example.com/a.jpg");
  });

  it("catches an extensionless CDN link under a field that promises one", () => {
    // Real CDNs serve images from paths with no extension. Testing the
    // value alone would report "no photos" for a feed full of them.
    const found = imageFieldsIn({ image: "https://img.example.com/p/9f2a1c" });
    expect(found.map((f) => f.path)).toEqual(["image"]);
  });

  it("catches a .jpg under a field name nobody would guess", () => {
    // And testing the field NAME alone would miss this one, which is
    // why both tests run and either is enough.
    const found = imageFieldsIn({ cover: "https://cdn.example.com/x.jpeg" });
    expect(found.map((f) => f.path)).toEqual(["cover"]);
  });

  it("ignores links that are neither", () => {
    const found = imageFieldsIn({
      detailUrl: "https://example.com/listing/123",
      website: "https://example.com",
      note: "photos available on request",
    });
    expect(found).toEqual([]);
  });

  it("reports nothing for a payload with no pictures at all", () => {
    // The answer this probe exists to be able to give honestly.
    expect(
      imageFieldsIn({ results: [{ address: "1 Main St", rent: 1800 }] })
    ).toEqual([]);
  });

  it("survives nulls, numbers and deep nesting without throwing", () => {
    const deep = { a: { b: { c: { d: { e: { f: null, g: 42 } } } } } };
    expect(() => imageFieldsIn(deep)).not.toThrow();
    expect(imageFieldsIn(deep)).toEqual([]);
  });

  it("keeps a query string on the sample URL", () => {
    const found = imageFieldsIn({ photo: "https://cdn.example.com/a.jpg?w=800" });
    expect(found[0].sample).toBe("https://cdn.example.com/a.jpg?w=800");
  });
});

describe("finding an id to feed the next call", () => {
  it("pulls ids out of a search result without knowing the schema", () => {
    const payload = {
      content: { properties: [{ id: 43148625, address: "1 Main St" }] },
    };
    expect(idFieldsIn(payload)).toEqual([
      { path: "content.properties[].id", sample: "43148625" },
    ]);
  });

  it("takes the vendor's other spellings of the same thing", () => {
    const found = idFieldsIn({ rows: [{ property_id: 7, mls_id: "X-9" }] });
    expect(found.map((f) => f.path).sort()).toEqual([
      "rows[].mls_id",
      "rows[].property_id",
    ]);
  });

  it("ignores fields that merely contain 'id'", () => {
    // "paid", "video", "guid" — a substring match would take all three
    // and hand a useless value to the next call.
    expect(idFieldsIn({ paid: true, video: "x", guid_url: "y" })).toEqual([]);
  });

  it("keeps one sample per path, not one per row", () => {
    const found = idFieldsIn({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    expect(found).toHaveLength(1);
    expect(found[0].sample).toBe("1");
  });
});
