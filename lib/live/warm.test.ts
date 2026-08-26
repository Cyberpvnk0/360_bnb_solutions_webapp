import { describe, expect, it } from "vitest";

import { warmSlice } from "./warm";

describe("warmSlice", () => {
  const list = ["a", "b", "c", "d", "e"];

  it("walks the whole list across a day of hourly runs", () => {
    const touched = new Set<string>();
    for (let hour = 0; hour < 24; hour++) {
      for (const slug of warmSlice(list, hour)) touched.add(slug);
    }
    expect([...touched].sort()).toEqual([...list].sort());
  });

  it("never repeats within one run and wraps cleanly", () => {
    for (let hour = 0; hour < 24; hour++) {
      const slice = warmSlice(list, hour);
      expect(new Set(slice).size).toBe(slice.length);
      expect(slice.length).toBe(2);
    }
  });

  it("handles a list smaller than the slice", () => {
    expect(warmSlice(["only"], 7)).toEqual(["only"]);
    expect(warmSlice([], 7)).toEqual([]);
  });
});
