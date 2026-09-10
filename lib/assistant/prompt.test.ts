import { describe, expect, it } from "vitest";
import { isOutOfScope, OUT_OF_SCOPE, SYSTEM_PROMPT } from "./prompt";

describe("the one reply to anything off the subject", () => {
  it("is in the instructions word for word, with the rule around it", () => {
    expect(SYSTEM_PROMPT).toContain(OUT_OF_SCOPE);
    expect(SYSTEM_PROMPT).toContain("do not use any tool");
    expect(SYSTEM_PROMPT).toMatch(/opinion about a person, coach, course, program, brand or company/);
  });

  it("is recognised as given, with a stray word or a different case", () => {
    expect(isOutOfScope(OUT_OF_SCOPE)).toBe(true);
    expect(isOutOfScope(`  ${OUT_OF_SCOPE}\n`)).toBe(true);
    expect(isOutOfScope("This is outside my allowed scope, sorry.")).toBe(true);
    expect(isOutOfScope("Found it on Zillow.")).toBe(false);
    expect(isOutOfScope("")).toBe(false);
  });
});
