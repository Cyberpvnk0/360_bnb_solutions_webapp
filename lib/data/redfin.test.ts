import { describe, expect, it } from "vitest";
import { REDFIN_REASONS } from "@/lib/live/redfin";
import {
  redfinFailureLabel,
  redfinRetryable,
  type RedfinFailureReason,
} from "./redfin";

/**
 * The bug these exist for:
 *
 * The server could throw `no-credits` and the browser's list of reasons
 * had never heard of it, so the label function fell through to its
 * default and told the member "Furnished search unreachable" about a
 * scraping plan that had simply run out of credits for the month. Two
 * hand-written unions, one of them quietly stale, and a catch-all
 * default that made the drift invisible.
 *
 * So the test is not "does this reason produce a nice string" — it is
 * "can any reason the server knows about reach the default". Adding a
 * reason on the server now fails here until the browser has a sentence
 * for it.
 */
const CATCH_ALL = redfinFailureLabel(undefined);

/**
 * The one reason allowed to share the catch-all, named here on purpose.
 *
 * "Unreachable" is exactly what a network failure is, so `network` and
 * the default saying the same thing is correct rather than sloppy.
 * Listing it by name keeps the guard below sharp: any reason ADDED to
 * the server still fails this until somebody writes its sentence.
 */
const DELIBERATELY_GENERIC: readonly string[] = ["network"];

const NAMED = REDFIN_REASONS.filter((r) => !DELIBERATELY_GENERIC.includes(r));

describe("every server reason reaches the member as itself", () => {
  it.each(NAMED)("%s does not fall through to the catch-all", (reason) => {
    const label = redfinFailureLabel(reason as RedfinFailureReason);
    expect(label).not.toBe(CATCH_ALL);
    expect(label.trim().length).toBeGreaterThan(0);
  });

  it("leaves exactly one reason on the catch-all, and it is network", () => {
    const generic = REDFIN_REASONS.filter(
      (r) => redfinFailureLabel(r as RedfinFailureReason) === CATCH_ALL
    );
    expect(generic).toEqual(["network"]);
  });

  it("gives the client-only reasons their own sentence too", () => {
    for (const reason of ["unknown-market", "daily-cap"] as RedfinFailureReason[]) {
      expect(redfinFailureLabel(reason)).not.toBe(CATCH_ALL);
    }
  });

  it("still has a catch-all for a reason nobody has written yet", () => {
    expect(redfinFailureLabel(undefined)).toBe(CATCH_ALL);
    expect(redfinFailureLabel("network")).toBe(CATCH_ALL);
  });
});

describe("what the member is told", () => {
  it("never names a supplier", () => {
    const all = [...REDFIN_REASONS, "unknown-market", "daily-cap", undefined]
      .map((r) => redfinFailureLabel(r as RedfinFailureReason))
      .join(" ")
      .toLowerCase();
    for (const vendor of ["redfin", "scraperapi", "scraper", "zillow", "rentcast"]) {
      expect(all).not.toContain(vendor);
    }
  });

  it("separates the four things that used to share one sentence", () => {
    const distinct = new Set(
      (["no-credits", "timeout", "http", "no-city"] as RedfinFailureReason[]).map(
        redfinFailureLabel
      )
    );
    expect(distinct.size).toBe(4);
  });

  it("tells a member out of capacity from a member out of luck", () => {
    expect(redfinFailureLabel("no-credits")).not.toBe(redfinFailureLabel("daily-cap"));
    expect(redfinFailureLabel("timeout")).toMatch(/try again/i);
  });
});

describe("whether clicking again is worth it", () => {
  it("is true for the transient ones", () => {
    for (const reason of ["timeout", "quota", "http", "network"] as RedfinFailureReason[]) {
      expect(redfinRetryable(reason)).toBe(true);
    }
  });

  it("is false where a retry changes nothing", () => {
    for (const reason of [
      "no-city",
      "no-key",
      "no-credits",
      "daily-cap",
      "unknown-market",
    ] as RedfinFailureReason[]) {
      expect(redfinRetryable(reason)).toBe(false);
    }
  });
});
