import { describe, expect, it } from "vitest";
import { arraysOfObjects, atPath, findJsonBlobs, objectAt } from "./redfin-page-json";

/**
 * Finding the search rows a page carries inside itself.
 *
 * Written before the mapper on purpose. The supplier's structured
 * Redfin endpoint does not read rental searches, so this product has
 * to read the page — and the last adapter written by inferring field
 * names from what looked reasonable cost days. These pin the finding,
 * so the shape report a diagnostic prints can be trusted.
 */

describe("balancing braces", () => {
  it("does not stop at a brace inside a string", () => {
    const doc = 'x = {"note":"a } here","n":1} tail';
    expect(objectAt(doc, 4)).toBe('{"note":"a } here","n":1}');
  });

  it("survives an escaped quote inside that string", () => {
    const doc = 'x = {"note":"say \\" then }","n":1} tail';
    const out = objectAt(doc, 4);
    expect(out).toBeTruthy();
    expect(JSON.parse(out as string)).toMatchObject({ n: 1 });
  });

  it("handles nesting", () => {
    const doc = 'x = {"a":{"b":{"c":1}}} tail';
    expect(JSON.parse(objectAt(doc, 4) as string)).toEqual({ a: { b: { c: 1 } } });
  });

  it("returns null on an object that never closes", () => {
    expect(objectAt('x = {"a":1', 4)).toBeNull();
  });

  it("returns null when the offset is not an object", () => {
    expect(objectAt("x = [1,2]", 4)).toBeNull();
  });
});

describe("finding the page's blobs", () => {
  const big = (n: number) =>
    JSON.stringify({ pad: "x".repeat(n), homes: [{ a: 1 }, { a: 2 }, { a: 3 }] });

  it("reads a window assignment", () => {
    const doc = `<script>root.__reactServerState.InitialContext = ${big(3000)};</script>`;
    const blobs = findJsonBlobs(doc);
    expect(blobs).toHaveLength(1);
    expect(blobs[0].marker).toContain("InitialContext");
  });

  it("reports one assignment ONCE, though several markers match it", () => {
    // "root.__reactServerState" is a prefix of the longer marker, so
    // without deduping the same payload appears three times and reads
    // as three different places the rows might live.
    const doc = `<script>root.__reactServerState.InitialContext = ${big(3000)};</script>`;
    expect(findJsonBlobs(doc)).toHaveLength(1);
  });

  it("reads a JSON script tag", () => {
    const doc = `<script type="application/json">${big(3000)}</script>`;
    expect(findJsonBlobs(doc)[0].marker).toContain("application/json");
  });

  it("puts the biggest first, because the rows are in the big one", () => {
    const doc = `<script type="application/json">${big(3000)}</script>
      <script>window.__INITIAL_STATE__ = ${big(9000)};</script>`;
    const blobs = findJsonBlobs(doc);
    expect(blobs[0].bytes).toBeGreaterThan(blobs[1].bytes);
  });

  it("ignores a marker whose brace is far away — that brace is not its object", () => {
    const doc = `root.__reactServerState = "not here"; ${" ".repeat(200)} ${big(3000)}`;
    expect(findJsonBlobs(doc)).toHaveLength(0);
  });

  it("skips anything too small to be a search payload", () => {
    const doc = `<script>window.__INITIAL_STATE__ = {"a":1};</script>`;
    expect(findJsonBlobs(doc)).toHaveLength(0);
  });

  it("does not throw on malformed JSON", () => {
    const doc = `<script>window.__INITIAL_STATE__ = {"a":${"1".repeat(3000)},};</script>`;
    expect(() => findJsonBlobs(doc)).not.toThrow();
  });
});

describe("locating the row array", () => {
  const payload = {
    config: { tz: "EST" },
    search: {
      results: {
        homes: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
        facets: [{ k: 1 }, { k: 2 }],
      },
    },
  };

  it("names the longest array of objects, by path", () => {
    const found = arraysOfObjects(payload);
    expect(found[0]).toEqual({ path: "search.results.homes", length: 4 });
  });

  it("ignores arrays shorter than a search result set", () => {
    expect(arraysOfObjects(payload).map((f) => f.path)).not.toContain("search.results.facets");
  });

  it("reads its own path back out", () => {
    expect(atPath(payload, "search.results.homes")).toHaveLength(4);
  });

  it("reads a path through an array index", () => {
    expect(atPath({ a: [{ b: [{ c: 1 }, { c: 2 }, { c: 3 }] }] }, "a[0].b")).toHaveLength(3);
  });

  it("answers undefined for a path that is not there", () => {
    expect(atPath(payload, "search.nope.homes")).toBeUndefined();
  });

  it("does not report an array of scalars as rows", () => {
    expect(arraysOfObjects({ ids: [1, 2, 3, 4, 5] })).toHaveLength(0);
  });
});
