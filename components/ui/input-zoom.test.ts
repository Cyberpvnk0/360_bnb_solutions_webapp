import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No text box small enough to make Safari zoom the page.
 *
 * Mobile Safari zooms in on focus for any input under 16px, which on a
 * phone throws the layout sideways before a character is typed —
 * tapping the Deal Finder's search box did exactly that. The cure is
 * always the same shape: `text-base` at mobile width, the designed size
 * from a breakpoint up.
 *
 * This walks the source rather than the DOM because it is a rule about
 * what gets written, and the failure is invisible on a desktop — which
 * is how two boxes shipped with it.
 */
const SMALL = /\btext-(xs|sm)\b/;
const HAS_MOBILE_BASE = /\btext-base\b/;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsxFiles(path));
    else if (entry.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/** The className of every `<input`, with its own attributes only. */
function inputClasses(source: string): string[] {
  const out: string[] = [];
  for (const tag of source.split("<input").slice(1)) {
    const body = tag.slice(0, tag.indexOf(">"));
    for (const m of body.matchAll(/className=(?:"([^"]*)"|\{cn\(([^)]*)\))/g)) {
      out.push(m[1] ?? m[2] ?? "");
    }
  }
  return out;
}

describe("text inputs on a phone", () => {
  it("are never under 16px at mobile width", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles("components")) {
      for (const cls of inputClasses(readFileSync(file, "utf8"))) {
        // A small size is fine only when a 16px base sits beside it —
        // `text-base md:text-sm` is the pattern.
        if (SMALL.test(cls) && !HAS_MOBILE_BASE.test(cls)) {
          offenders.push(`${file}: ${cls.slice(0, 90)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
