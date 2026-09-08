import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capFor, consumeUsage, currentPeriod } from "./usage";
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
    // $0.18 purchase plus ~$0.07 of contacts and images, every market a
    // lone ~$0.10 re-buy, and the tier still keeps more than half.
    for (const id of ["starter", "pro", "scale"] as const) {
      const t = TIERS[id];
      const worst = t.pullLimit * 0.25 + t.marketLimit * 0.1;
      expect(t.priceMonthly - worst).toBeGreaterThan(t.priceMonthly * 0.5);
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

  it("refuses outright when the plan carries none, without a round trip", async () => {
    // Free has no analyses. There is nothing to ask the store.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await consumeUsage("u1", "free", "analysis", "k");
    expect(r.allowed).toBe(false);
    expect(r.cap).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("passes the plan's cap to the store and returns its verdict", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ allowed: false, used: 10, cap: 10 }]), { status: 200 })
    );
    const r = await consumeUsage("u1", "starter", "analysis", "estimate:x", new Date("2026-09-08T12:00:00Z"));
    expect(r).toEqual({ allowed: false, used: 10, cap: 10, kind: "analysis" });
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
