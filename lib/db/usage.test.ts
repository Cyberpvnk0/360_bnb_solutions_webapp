import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capFor, consumeUsage, currentPeriod, grantPack } from "./usage";
import { TIERS } from "@/config/app";

describe("the plan month", () => {
  it("is a UTC year-month, so every instance rolls together", () => {
    expect(currentPeriod(new Date("2026-09-08T23:59:59Z"))).toBe("2026-09");
    expect(currentPeriod(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10");
  });
});

describe("what each plan is owed", () => {
  it("reads the caps off the same config the prices live in", () => {
    // One source of truth: the cap beside the price it was priced for.
    expect(capFor("starter", "analysis")).toBe(TIERS.starter.pullLimit);
    expect(capFor("scale", "market")).toBe(TIERS.scale.marketLimit);
  });

  it("gives an unknown tier the free plan, never a bigger one", () => {
    expect(capFor("nonsense" as never, "analysis")).toBe(TIERS.free.pullLimit);
  });

  it("clears its cost in the worst case on every paid tier", () => {
    // The guarantee the caps were sized for: every analysis a fresh
    // $0.18 purchase plus ~$0.07 of contacts and images, every market
    // bought once for this account alone at ~$0.10, and the tier still
    // keeps more than forty percent. That case never happens — it is
    // zero cache sharing at full utilisation — which is why the bar is
    // a floor and not the plan.
    for (const id of ["starter", "pro", "scale"] as const) {
      const t = TIERS[id];
      const worst = t.pullLimit * 0.25 + t.marketLimit * 0.1;
      expect(t.priceMonthly - worst).toBeGreaterThan(t.priceMonthly * 0.4);
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

  it("refuses a market on Free outright, without a round trip", async () => {
    // Free touches nothing that costs money. A market never draws on a
    // pack, so a zero cap is final and there is nothing to ask the
    // store — the reply is immediate and the client falls back to
    // preview rows.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await consumeUsage("u1", "free", "market", "market:tampa");
    expect(TIERS.free.marketLimit).toBe(0);
    expect(r.allowed).toBe(false);
    expect(r.cap).toBe(0);
    expect(r.source).toBe("none");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still asks the store for an analysis on a plan with none, because a pack may cover it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ allowed: true, used: 1, cap: 0, source: "pack", balance: 4 }]), { status: 200 })
    );
    const r = await consumeUsage("u1", "free", "analysis", "k");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ allowed: true, source: "pack", balance: 4 });
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
    const cap = TIERS.starter.pullLimit;
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
      p_cap: TIERS.starter.pullLimit,
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
