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

/**
 * Moving an address is two writes: the login, and the copy every admin
 * surface reads. The second one failing quietly is what points Send
 * reset email at an address the account no longer has — and the
 * recovery endpoint answers 200 for an address it does not know, so
 * the failure would never surface on its own.
 */
describe("when only half of an address change lands", () => {
  const OLD_URL = process.env.SUPABASE_URL;
  const OLD_KEY = process.env.SUPABASE_SECRET_KEY;

  afterEach(() => {
    if (OLD_URL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = OLD_URL;
    if (OLD_KEY === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = OLD_KEY;
  });

  /** Auth says yes; the profile patch answers however the test says. */
  function store(profilePatch: { ok: boolean } | "throws") {
    process.env.SUPABASE_URL = "https://store.example";
    process.env.SUPABASE_SECRET_KEY = "secret";
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/v1/")) return new Response("{}", { status: 200 });
      if (profilePatch === "throws") throw new TypeError("fetch failed");
      // `new Response("", { status: 204 })` throws — 204 may carry no body,
      // and the rejection would land in the same catch a real failure does.
      return new Response(null, { status: profilePatch.ok ? 204 : 503 });
    }) as unknown as typeof fetch;
  }

  it("says so when the directory copy did not update", async () => {
    store({ ok: false });
    const out = await setEmail("u-1", "new@example.com");
    expect(out.ok).toBe(true);
    // The login DID move — reporting failure would be its own lie.
    if (out.ok) {
      expect(out.detail).toBe("new@example.com");
      expect(out.warning).toBeTruthy();
      // Names the thing an operator would otherwise do next and get
      // a false success from.
      expect(out.warning).toMatch(/reset/i);
    }
  });

  it("says so when the patch never reached the store at all", async () => {
    store("throws");
    const out = await setEmail("u-1", "new@example.com");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.warning).toBeTruthy();
  });

  it("stays quiet when both writes landed", async () => {
    store({ ok: true });
    const out = await setEmail("u-1", "new@example.com");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.warning).toBeUndefined();
      expect(out.detail).toBe("new@example.com");
    }
  });
});
