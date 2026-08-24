import { describe, expect, it } from "vitest";
import { mineFeatures } from "./features";

describe("mineFeatures", () => {
  it("distinguishes 'we were told nothing' from 'it has none of these'", () => {
    // The whole honesty contract rests on this pair. Null lets the UI
    // disable a filter; an empty array lets it exclude the row.
    expect(mineFeatures([])).toBeNull();
    expect(mineFeatures([undefined, null, "   "])).toBeNull();
    expect(mineFeatures(["A 2 bedroom unit near the river."])).toEqual([]);
  });

  it("reads tags out of prose", () => {
    const found = mineFeatures([
      "Fully furnished 2 bed with a private pool, hot tub, and a two car garage.",
    ]);
    expect(found).toEqual(
      expect.arrayContaining(["Furnished", "Private pool", "Hot tub", "Garage"])
    );
  });

  it("reads tags out of an amenity list just as well as prose", () => {
    expect(mineFeatures(["Furnished", "Waterfront"])).toEqual(
      expect.arrayContaining(["Furnished", "Waterfront"])
    );
  });

  it("refuses to call a negated mention a feature", () => {
    // Each of these contains the word a naive matcher wants. A wrong
    // Furnished tag costs a student a call on a unit they'd have to
    // furnish themselves, so ambiguity loses.
    for (const text of [
      "This unit is unfurnished.",
      "The apartment is not furnished.",
      "Furniture not included.",
      "No furniture provided at move-in.",
      "Furnished optional — ask about our packages.",
      "Can be furnished for an additional monthly fee.",
    ]) {
      expect(mineFeatures([text]), text).not.toContain("Furnished");
    }
  });

  it("drops the tag when a page says both things", () => {
    // Sister-building copy is a real pattern on listing pages, and the
    // honest answer to an ambiguous page is no tag, not a coin flip.
    const found = mineFeatures([
      "This unfurnished 2 bed rents for $1,800. Furnished units are " +
        "available in our sister building.",
    ]);
    expect(found).not.toContain("Furnished");
  });

  it("does not read 'unfurnished' as 'furnished' by accident", () => {
    // Word boundaries already reject the substring; this pins it so a
    // future pattern edit can't silently reintroduce the bug.
    expect(mineFeatures(["Spacious unfurnished townhome."])).toEqual([]);
  });

  it("honors negations for the other guarded features too", () => {
    expect(mineFeatures(["Sorry, no pets allowed."])).not.toContain(
      "Pet friendly"
    );
    expect(mineFeatures(["Street parking only, no garage."])).not.toContain(
      "Garage"
    );
  });

  it("returns each tag once no matter how often it is implied", () => {
    const found = mineFeatures([
      "Furnished! Fully furnished throughout. Did we mention furnished?",
    ]);
    expect(found).toEqual(["Furnished"]);
  });
});
