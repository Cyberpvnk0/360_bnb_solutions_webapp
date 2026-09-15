import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The daily call brake, read from the environment.
 *
 * It is meant to be OFF unless an operator names a figure, because any
 * figure here sits above paying users: a brake below what the plans
 * entitle hands students modelled comps after the first busy hour, in
 * a product whose whole promise is measured ones.
 *
 * Number("") is 0. 0 is finite and >= 0. So a variable sitting in the
 * dashboard with nothing typed into it — the normal state of a row
 * somebody added and never filled — set the brake to ZERO and refused
 * every live comp call from the first request of the day, for
 * everybody, silently.
 */

const real = process.env.AIRROI_DAILY_CALLS;

afterEach(() => {
  if (real === undefined) delete process.env.AIRROI_DAILY_CALLS;
  else process.env.AIRROI_DAILY_CALLS = real;
  vi.resetModules();
});

/** The module reads the variable once, at load. */
async function budgetWith(value: string | undefined) {
  if (value === undefined) delete process.env.AIRROI_DAILY_CALLS;
  else process.env.AIRROI_DAILY_CALLS = value;
  vi.resetModules();
  const { airRoiBudget } = await import("./airroi");
  return airRoiBudget();
}

describe("the daily call brake", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace", "   "],
    ["not a number", "lots"],
  ])("is OFF when the variable is %s", async (_label, value) => {
    const { cap, left } = await budgetWith(value);
    expect(cap).toBe(Number.POSITIVE_INFINITY);
    expect(left).toBeGreaterThan(0);
  });

  it("holds the figure an operator actually names", async () => {
    expect((await budgetWith("500")).cap).toBe(500);
    expect((await budgetWith(" 500 ")).cap).toBe(500);
  });

  /**
   * Zero typed on purpose still means zero. An operator who wants live
   * comps off has said so, and this must keep obeying them — the fix
   * above is about a variable that was never filled in, not about
   * refusing to be switched off.
   */
  it("still lets an operator brake to zero deliberately", async () => {
    const { cap, left } = await budgetWith("0");
    expect(cap).toBe(0);
    expect(left).toBe(0);
  });
});
