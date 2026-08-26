import { describe, expect, it } from "vitest";

import { withScraperSlot } from "./limit";

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
    // Twelve at once — the exact shape that produced six concurrent
    // vendor requests and a 429ed pass.
    await Promise.all(Array.from({ length: 12 }, job));
    expect(peak).toBeLessThanOrEqual(3);
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
