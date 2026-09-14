import { describe, expect, it } from "vitest";
import { chordLabel, isTypingTarget, shortcutFor } from "./shortcuts";

const input = (type = "text") => ({ tagName: "INPUT", type });

describe("isTypingTarget", () => {
  it("is true where somebody is writing", () => {
    expect(isTypingTarget(input())).toBe(true);
    expect(isTypingTarget(input("search"))).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("is false for a control that takes clicks, not prose", () => {
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget({ tagName: "A" })).toBe(false);
    for (const t of ["button", "submit", "checkbox", "radio", "range", "file"]) {
      expect(isTypingTarget(input(t))).toBe(false);
    }
  });

  it("survives a target that is not an element", () => {
    for (const junk of [null, undefined, 7, "input", {}]) {
      expect(isTypingTarget(junk)).toBe(false);
    }
  });
});

describe("shortcutFor", () => {
  it("sends a bare slash to the search box", () => {
    expect(shortcutFor({ key: "/", target: { tagName: "BODY" } })).toBe("search");
    expect(shortcutFor({ key: "/", target: { tagName: "BUTTON" } })).toBe("search");
  });

  it("NEVER steals a slash out of somebody's sentence", () => {
    expect(shortcutFor({ key: "/", target: input() })).toBeNull();
    expect(shortcutFor({ key: "/", target: { tagName: "TEXTAREA" } })).toBeNull();
    expect(
      shortcutFor({ key: "/", target: { tagName: "DIV", isContentEditable: true } })
    ).toBeNull();
  });

  it("takes the chord on either platform, and even mid-sentence", () => {
    expect(shortcutFor({ key: "k", metaKey: true, target: input() })).toBe("markets");
    expect(shortcutFor({ key: "k", ctrlKey: true, target: input() })).toBe("markets");
    // Shift-held or capitalised by the OS is the same chord.
    expect(shortcutFor({ key: "K", metaKey: true })).toBe("markets");
  });

  it("leaves every other combination alone", () => {
    expect(shortcutFor({ key: "k" })).toBeNull();
    expect(shortcutFor({ key: "k", altKey: true, metaKey: true })).toBeNull();
    // A browser's own find, and a slash with a modifier, are not ours.
    expect(shortcutFor({ key: "f", metaKey: true })).toBeNull();
    expect(shortcutFor({ key: "/", metaKey: true, target: { tagName: "BODY" } })).toBeNull();
    expect(shortcutFor({ key: "Escape" })).toBeNull();
    expect(shortcutFor({ key: "a", target: { tagName: "BODY" } })).toBeNull();
  });
});

describe("chordLabel", () => {
  it("writes the chord the way the platform does", () => {
    expect(chordLabel("MacIntel")).toBe("⌘K");
    expect(chordLabel("iPhone")).toBe("⌘K");
    expect(chordLabel("Win32")).toBe("Ctrl K");
    expect(chordLabel("Linux x86_64")).toBe("Ctrl K");
    expect(chordLabel(undefined)).toBe("Ctrl K");
  });
});
