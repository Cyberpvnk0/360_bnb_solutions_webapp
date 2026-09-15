import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeCall } from "./user-data";
import { NO_CALLS } from "@/lib/mock/types";

/**
 * The write that must never lie about landing.
 *
 * A call log is the one thing in this product a person is TOLD to
 * write down — what a landlord said, seconds after hanging up. It is
 * also the one thing they cannot reconstruct. So "saved" has to mean
 * saved: a PostgREST update that matches no row answers 204 with no
 * error, and the bare version of this reported that as success.
 */

/** A client that records the filters and answers with `rows`. */
function client(answer: { data?: unknown[]; error?: { message: string } | null }) {
  const filters: [string, string][] = [];
  const chain = {
    update: vi.fn(() => chain),
    eq: vi.fn((col: string, val: string) => {
      filters.push([col, val]);
      return chain;
    }),
    select: vi.fn(async () => ({
      data: answer.data ?? null,
      error: answer.error ?? null,
    })),
  };
  return {
    supabase: { from: vi.fn(() => chain) } as unknown as SupabaseClient,
    chain,
    filters,
  };
}

const call = { ...NO_CALLS, outcome: "spoke" as const, note: "Open to 12mo", attempts: 1 };

describe("logging a call against a saved rental", () => {
  it("reports success when a row actually changed", async () => {
    const { supabase } = client({ data: [{ listing_id: "live--a" }] });
    await expect(writeCall(supabase, "l-1", "live--a", call)).resolves.toEqual({
      ok: true,
      error: null,
    });
  });

  it("REPORTS FAILURE when it matched nothing — the row is gone", async () => {
    // Another tab removed the property, or its insert never landed.
    // PostgREST answers 204 with no error, which the caller must not
    // read as "your note is safe".
    const { supabase } = client({ data: [] });
    const out = await writeCall(supabase, "l-1", "live--gone", call);
    expect(out.ok).toBe(false);
    expect(out.error).toBeTruthy();
  });

  it("reports failure when the store refuses — an unmigrated column, say", async () => {
    const { supabase } = client({
      error: { message: "column deal_list_items.call_outcome does not exist" },
    });
    const out = await writeCall(supabase, "l-1", "live--a", call);
    expect(out.ok).toBe(false);
    expect(out.error).toContain("call_outcome");
  });

  it("targets exactly one rental in exactly one list", async () => {
    const { supabase, filters } = client({ data: [{ listing_id: "live--a" }] });
    await writeCall(supabase, "l-1", "live--a", call);
    expect(filters).toEqual([
      ["list_id", "l-1"],
      ["listing_id", "live--a"],
    ]);
  });

  it("writes every field of the log, and nothing else", async () => {
    const { supabase, chain } = client({ data: [{ listing_id: "live--a" }] });
    await writeCall(supabase, "l-1", "live--a", {
      outcome: "voicemail",
      note: "Left a message",
      lastCalledAt: "2026-09-14T10:00:00.000Z",
      attempts: 3,
    });
    expect(chain.update).toHaveBeenCalledWith({
      call_outcome: "voicemail",
      call_note: "Left a message",
      call_attempts: 3,
      last_called_at: "2026-09-14T10:00:00.000Z",
    });
  });

  it("asks for what it changed — without that there is nothing to check", async () => {
    const { supabase, chain } = client({ data: [{ listing_id: "live--a" }] });
    await writeCall(supabase, "l-1", "live--a", call);
    expect(chain.select).toHaveBeenCalled();
  });
});
