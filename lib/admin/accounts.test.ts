import { afterEach, describe, expect, it, vi } from "vitest";
import {
  grantCredits,
  MAX_GRANT,
  MAX_PASSWORD,
  MIN_PASSWORD,
  setEmail,
  setPassword,
} from "./accounts";

/**
 * The guards in front of the most dangerous calls in the product.
 *
 * Every one of these refuses BEFORE reaching the network, which is the
 * property actually being tested: a bad argument must not become a
 * request to the auth server that half-succeeds. So the fetch is a spy
 * that fails the test if it is ever called — asserting the refusal
 * alone would pass just as well for code that refused afterwards.
 */

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
  vi.restoreAllMocks();
});

/** A fetch that must never run. */
function forbidden() {
  const spy = vi.fn(async () => {
    throw new Error("reached the network");
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

describe("setting a password", () => {
  it("refuses one that is too short, without calling out", async () => {
    const spy = forbidden();
    const out = await setPassword("u-1", "a".repeat(MIN_PASSWORD - 1));
    expect(out.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses one past the hash's limit", async () => {
    const spy = forbidden();
    const out = await setPassword("u-1", "a".repeat(MAX_PASSWORD + 1));
    expect(out.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("says the bounds rather than just 'invalid'", async () => {
    forbidden();
    const out = await setPassword("u-1", "short");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.detail).toContain(String(MIN_PASSWORD));
      expect(out.detail).toContain(String(MAX_PASSWORD));
    }
  });

  it("never echoes the password back in the result", async () => {
    forbidden();
    const secret = "correct-horse-battery";
    const out = await setPassword("u-1", secret);
    expect(JSON.stringify(out)).not.toContain(secret);
  });
});

describe("changing the email on file", () => {
  it.each(["not-an-email", "a@b", "@example.com", "two@@example.com", " ", ""])(
    "refuses %j without calling out",
    async (bad) => {
      const spy = forbidden();
      const out = await setEmail("u-1", bad);
      expect(out.ok).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    }
  );
});

describe("granting credits", () => {
  it.each([0, -5, 1.5, Number.NaN, MAX_GRANT + 1])(
    "refuses %p without calling out",
    async (amount) => {
      const spy = forbidden();
      const out = await grantCredits("u-1", amount, "alec@example.com");
      expect(out.ok).toBe(false);
      expect(out.granted).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    }
  );

  it("names the range it will accept", async () => {
    forbidden();
    const out = await grantCredits("u-1", 0, "alec@example.com");
    expect(out.detail).toContain(String(MAX_GRANT));
  });
});
