import { beforeEach, describe, expect, it } from "vitest";
import {
  accessCodeEnabled,
  allowAttempt,
  codeMatches,
  MAX_ATTEMPTS,
  normaliseCode,
  resetAttemptsForTests,
} from "./access-code";

/**
 * The code is a full admin, so what matters is how it refuses. The
 * built-in code is not in the repository; its hash is checked against
 * the code by hand, and everything else is checked here with a
 * deployment-set code.
 */

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

beforeEach(() => resetAttemptsForTests());

describe("codeMatches", () => {
  it("forgives case, spaces and dashes, and nothing else", async () => {
    const e = env({ ADMIN_ACCESS_CODE: "WXYZ-2345-ABCD-6789" });
    expect(await codeMatches("WXYZ-2345-ABCD-6789", e)).toBe(true);
    expect(await codeMatches("wxyz 2345 abcd 6789", e)).toBe(true);
    expect(await codeMatches("WXYZ2345ABCD6789", e)).toBe(true);
    expect(await codeMatches("WXYZ-2345-ABCD-6788", e)).toBe(false);
    expect(await codeMatches("WXYZ-2345-ABCD", e)).toBe(false);
  });

  it("lets a deployment-set code replace the built-in one", async () => {
    // With an override set, only the override opens the door.
    expect(await codeMatches("anything-else", env({ ADMIN_ACCESS_CODE: "NEW-CODE-1234" }))).toBe(false);
    expect(await codeMatches("NEW-CODE-1234", env({ ADMIN_ACCESS_CODE: "NEW-CODE-1234" }))).toBe(true);
  });

  it("refuses empty input and guesses at the built-in code", async () => {
    expect(await codeMatches("", env({}))).toBe(false);
    expect(await codeMatches("----", env({}))).toBe(false);
    expect(await codeMatches("AAAA-AAAA-AAAA-AAAA", env({}))).toBe(false);
    expect(await codeMatches("", env({ ADMIN_ACCESS_CODE: "   " }))).toBe(false);
  });

  it("opens nothing when code sign-in is off", async () => {
    const off = env({ ACCESS_CODE_LOGIN: "off", ADMIN_ACCESS_CODE: "NEW-CODE-1234" });
    expect(accessCodeEnabled(off)).toBe(false);
    expect(await codeMatches("NEW-CODE-1234", off)).toBe(false);
    expect(accessCodeEnabled(env({ ACCESS_CODE_LOGIN: "FALSE" }))).toBe(false);
    expect(accessCodeEnabled(env({}))).toBe(true);
  });

  it("normalises what a person types", () => {
    expect(normaliseCode(" ab-cd ef_9 ")).toBe("ABCDEF9");
  });
});

describe("allowAttempt", () => {
  it("slows guessing per caller and recovers after the window", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) expect(allowAttempt("1.2.3.4", t0 + i)).toBe(true);
    expect(allowAttempt("1.2.3.4", t0 + 100)).toBe(false);
    expect(allowAttempt("5.6.7.8", t0 + 100)).toBe(true);
    expect(allowAttempt("1.2.3.4", t0 + 11 * 60 * 1000)).toBe(true);
  });
});
