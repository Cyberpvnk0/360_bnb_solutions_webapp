import { describe, expect, it } from "vitest";
import {
  AMATEUR_FIELD,
  FIELD_NOTE,
  MIN_COMPS,
  PROFESSIONAL_FIELD,
  fieldOf,
  readCompetition,
  type CompetitionComp,
} from "./competition";

const mix = (managed: number, individual: number, badged = 0): CompetitionComp[] => [
  ...Array.from({ length: managed }, () => ({ pm: true, sh: false })),
  ...Array.from({ length: individual }, () => ({ pm: false, sh: false })),
  ...Array.from({ length: badged }, () => ({ pm: false, sh: true })),
];

describe("readCompetition", () => {
  it("reports the share of each flag and how many said", () => {
    const r = readCompetition(mix(6, 6))!;
    expect(r.managedOf).toBe(12);
    expect(r.managed).toBeCloseTo(0.5, 3);
    expect(r.badgedOf).toBe(12);
    expect(r.badged).toBe(0);
  });

  it("counts only comps that carried the flag", () => {
    // Twelve legacy comps with neither. Counting them as amateurs would
    // report every older market as a field of individual hosts.
    const legacy: CompetitionComp[] = Array.from({ length: 12 }, () => ({}));
    const r = readCompetition([...mix(8, 2), ...legacy])!;
    expect(r.managedOf).toBe(10);
    expect(r.managed).toBeCloseTo(0.8, 3);
  });

  it("says nothing on a pool too thin to characterise", () => {
    expect(readCompetition([])).toBeNull();
    expect(readCompetition(mix(MIN_COMPS - 1, 0))).toBeNull();
    expect(readCompetition(Array.from({ length: 40 }, () => ({})))).toBeNull();
  });
});

describe("fieldOf", () => {
  it("calls a mostly-managed market a professional field", () => {
    expect(fieldOf(readCompetition(mix(9, 1))!)).toBe("professional");
  });

  it("calls a mostly-individual market an individual field", () => {
    expect(fieldOf(readCompetition(mix(1, 9))!)).toBe("individual");
  });

  it("calls everything between them mixed, rather than guessing", () => {
    expect(fieldOf(readCompetition(mix(4, 6))!)).toBe("mixed");
  });

  it("holds its thresholds in the order the readings assume", () => {
    expect(AMATEUR_FIELD).toBeLessThan(PROFESSIONAL_FIELD);
  });

  it("says nothing when only the badge count carried the pool", () => {
    // Badges said, management did not: there is no field to call.
    const badgedOnly: CompetitionComp[] = Array.from({ length: 20 }, () => ({ sh: true }));
    const r = readCompetition(badgedOnly)!;
    expect(r.badgedOf).toBe(20);
    expect(fieldOf(r)).toBeNull();
  });

  it("has a plain reading for every field, and none of them a grade", () => {
    for (const note of Object.values(FIELD_NOTE)) {
      expect(note.length).toBeGreaterThan(20);
      expect(note).not.toMatch(/\b(good|bad|best|worst|avoid|grade)\b/i);
    }
  });
});
