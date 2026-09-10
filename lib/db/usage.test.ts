import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canCover,
  capFor,
  consumeUsage,
  currentPeriod,
  grantPack,
  mockCheckoutEnabled,
  setTier,
  spendCredits,
} from "./usage";
import { TIERS } from "@/config/app";

describe("the plan month", () => {
  it("is a UTC year-month, so every instance rolls together", () => {
    expect(currentPeriod(new Date("2026-09-08T23:59:59Z"))).toBe("2026-09");
    expect(currentPeriod(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10");
  });
});

describe("what each plan is owed", () => {
  it("reads one cap off the same config the prices live in", () => {
    // One source of truth: the credits beside the price they were
    // priced for — and one pool, whichever kind is spending.
    expect(capFor("starter")).toBe(TIERS.starter.creditLimit);
    expect(capFor("scale")).toBe(TIERS.scale.creditLimit);
  });

  it("gives an unknown tier the free plan, never a bigger one", () => {
    expect(capFor("nonsense" as never)).toBe(TIERS.free.creditLimit);
  });

  it("clears its cost in the worst case on every paid tier", () => {
    // The worst case for one pool: every credit a fresh analysis — a
    // $0.18 purchase plus ~$0.07 of contacts and images — with zero
    // cache sharing at full utilisation. That never happens, and the
    // plans were widened a little when the two allowances became one,
    // so the floor here is that the tier still clears its cost by a
    // fifth. The old split kept forty percent; the difference is the
    // price of the simpler plan.
    for (const id of ["starter", "pro", "scale"] as const) {
      const t = TIERS[id];
      const worst = t.creditLimit * 0.25;
      expect(t.priceMonthly - worst).toBeGreaterThan(t.priceMonthly * 0.2);
    }
  });
});

describe("claiming against the plan", () => {
  const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_t" };
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("refuses anything on Free outright, without a round trip", async () => {
    // Free touches nothing that costs money, and packs are only sold to
    // plans with credits — so a zero cap is final for both kinds and
    // there is nothing to ask the store.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(TIERS.free.creditLimit).toBe(0);
    for (const [kind, key] of [["market", "market:tampa"], ["analysis", "estimate:x"]] as const) {
      const r = await consumeUsage("u1", "free", kind, key);
      expect(r.allowed).toBe(false);
      expect(r.cap).toBe(0);
      expect(r.source).toBe("none");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports which pot paid and what is left", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ allowed: true, used: 11, cap: 10, source: "pack", balance: 34 }]), { status: 200 })
    );
    const r = await consumeUsage("u1", "starter", "analysis", "k");
    expect(r.source).toBe("pack");
    expect(r.balance).toBe(34);
    expect(r.used).toBe(11);
  });

  it("passes the plan's cap to the store and returns its verdict", async () => {
    // The mocked store echoes whatever cap it was handed, so this test
    // follows the config rather than pinning a number the plan may move.
    const cap = TIERS.starter.creditLimit;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ allowed: false, used: cap, cap }]), { status: 200 })
    );
    const r = await consumeUsage("u1", "starter", "analysis", "estimate:x", new Date("2026-09-08T12:00:00Z"));
    expect(r).toEqual({ allowed: false, used: cap, cap, kind: "analysis" });
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body).toEqual({
      p_user: "u1",
      p_period: "2026-09",
      p_kind: "analysis",
      p_key: "estimate:x",
      p_cap: TIERS.starter.creditLimit,
    });
  });

  it("fails open, and says so, when the meter cannot be reached", async () => {
    // A paying student refused what they paid for is the worse
    // outcome; the vendor's daily breaker still bounds the day. But it
    // is never silent — `unmetered` carries the reason.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    const r = await consumeUsage("u1", "pro", "market", "market:tampa");
    expect(r.allowed).toBe(true);
    expect(r.unmetered).toBeTruthy();
  });

  it("fails open with no store configured", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const r = await consumeUsage("u1", "pro", "analysis", "k");
    expect(r.allowed).toBe(true);
    expect(r.unmetered).toMatch(/no store/);
  });
});

describe("granting a pack", () => {
  const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_t" };
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends the pack's analyses under the payment reference", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ balance: 35, granted: true }]), { status: 200 })
    );
    const r = await grantPack("u1", "p25", "pay_123");
    expect(r).toEqual({ ok: true, balance: 35, granted: true, detail: null });
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body).toEqual({ p_user: "u1", p_amount: 35, p_reason: "pack:p25", p_ref: "pay_123" });
  });

  it("treats a repeated reference as fulfilled, not failed", async () => {
    // The processor retried its webhook. The store granted nothing the
    // second time and said so; the purchase is complete either way.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ balance: 35, granted: false }]), { status: 200 })
    );
    const r = await grantPack("u1", "p25", "pay_123");
    expect(r.ok).toBe(true);
    expect(r.granted).toBe(false);
    expect(r.balance).toBe(35);
  });

  it("refuses a pack it does not know", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await grantPack("u1", "p999" as never, "pay_1");
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("putting an account on a plan", () => {
  const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_t" };
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("writes the tier to the profile with the secret key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ tier: "pro" }]), { status: 200 })
    );
    const r = await setTier("u1", "pro");
    expect(r).toEqual({ ok: true, tier: "pro", detail: null });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/rest/v1/profiles?id=eq.u1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body)).tier).toBe("pro");
    expect((init?.headers as Record<string, string>).apikey).toBe("sb_secret_t");
  });

  it("refuses a tier it does not know, without a round trip", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await setTier("u1", "platinum" as never);
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports an account with no profile row rather than pretending", async () => {
    // The signup trigger should make this impossible; if it happens
    // anyway, a silent success would leave the header saying Pro and
    // every meter saying free.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    const r = await setTier("u1", "pro");
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/no profile/);
  });
});

describe("the demo checkout gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off unless a flag says this deployment is a demo", () => {
    vi.stubEnv("MOCK_CHECKOUT", "");
    vi.stubEnv("CREDITS_MOCK_CHECKOUT", "");
    expect(mockCheckoutEnabled()).toBe(false);
    vi.stubEnv("MOCK_CHECKOUT", "1");
    expect(mockCheckoutEnabled()).toBe(true);
  });

  it("still honours the older flag name", () => {
    vi.stubEnv("MOCK_CHECKOUT", "");
    vi.stubEnv("CREDITS_MOCK_CHECKOUT", "1");
    expect(mockCheckoutEnabled()).toBe(true);
  });
});

describe("spending several credits at once", () => {
  const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_t" };
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("passes the key, the amount and the plan's cap, and reports what was taken", async () => {
    const cap = TIERS.pro.creditLimit;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([{ allowed: true, used: 12, cap, source: "mixed", balance: 3, charged: 5 }]),
        { status: 200 }
      )
    );
    const r = await spendCredits("u1", "pro", "phone:fl:1804 sitka st e", 5, new Date("2026-09-10T12:00:00Z"));
    expect(r).toEqual({ allowed: true, used: 12, cap, source: "mixed", balance: 3, charged: 5 });
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({
      p_user: "u1",
      p_period: "2026-09",
      p_key: "phone:fl:1804 sitka st e",
      p_amount: 5,
      p_cap: cap,
    });
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/rpc/spend_credits");
  });

  it("takes nothing from a key already paid for, and refuses Free outright", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ allowed: true, used: 12, cap: 125, source: "cached", balance: 3, charged: 0 }]), { status: 200 })
    );
    const again = await spendCredits("u1", "pro", "phone:x", 5);
    expect(again.charged).toBe(0);
    expect(again.source).toBe("cached");
    fetchSpy.mockClear();
    const free = await spendCredits("u1", "free", "phone:x", 5);
    expect(free).toMatchObject({ allowed: false, charged: 0, source: "none" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads the room before the vendor is asked, plan and packs together", async () => {
    const cap = TIERS.starter.creditLimit;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/rest/v1/usage")) {
        return new Response(
          JSON.stringify([{ analysis_keys: new Array(cap - 3).fill("a"), market_slugs: [], spent: 0 }]),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify([{ balance: 1 }]), { status: 200 });
    });
    // Three left on the plan and one pack credit: four, short of five.
    expect(await canCover("u1", "starter", 5)).toEqual({ ok: false, remaining: 4 });
    expect(await canCover("u1", "starter", 4)).toEqual({ ok: true, remaining: 4 });
  });

  it("counts earlier weighted spends against the room", async () => {
    const cap = TIERS.starter.creditLimit;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/rest/v1/usage")) {
        return new Response(JSON.stringify([{ analysis_keys: [], market_slugs: [], spent: cap }]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    expect(await canCover("u1", "starter", 5)).toEqual({ ok: false, remaining: 0 });
  });
});
