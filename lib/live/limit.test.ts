import { describe, expect, it } from "vitest";

import { scraperConcurrency, withScraperSlot } from "./limit";

describe("withScraperSlot", () => {
  it("never lets more than the cap run at once", async () => {
    let active = 0;
    let peak = 0;
    const job = () =>
      withScraperSlot(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      });
    // Well past the cap at once — the shape that once produced more
    // concurrent vendor requests than the plan allowed and got a whole
    // pass 429ed.
    await Promise.all(Array.from({ length: scraperConcurrency * 4 }, job));
    expect(peak).toBeLessThanOrEqual(scraperConcurrency);
    // And it really did saturate, or the assertion above proves nothing.
    expect(peak).toBe(scraperConcurrency);
  });

  it("stays under the plan's thread count even if misconfigured", async () => {
    // Per-instance counter, fleet-wide limit: a value at or above the
    // plan's threads breaches it the moment a second instance is warm.
    expect(scraperConcurrency).toBeLessThanOrEqual(20);
  });

  it("keeps serving after a job throws", async () => {
    await expect(
      withScraperSlot(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    // The slot must have been released, or this second job hangs.
    const result = await withScraperSlot(async () => "still alive");
    expect(result).toBe("still alive");
  });
});
