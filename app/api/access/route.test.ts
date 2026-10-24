import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The door itself. Every refusal is checked to happen BEFORE any
 * account is touched or any session is set.
 */

let enabled = true;
let matches = false;
let allow = true;
vi.mock("@/lib/auth/access-code", () => ({
  accessCodeEnabled: () => enabled,
  allowAttempt: () => allow,
  codeMatches: async () => matches,
}));
const prepareAccessAccount = vi.fn();
vi.mock("@/lib/auth/access-account", () => ({ prepareAccessAccount: () => prepareAccessAccount() }));
const verifyOtp = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => ({ auth: { verifyOtp } }) }));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("https://x/api/access", { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } }));

beforeEach(() => {
  enabled = true;
  matches = false;
  allow = true;
  prepareAccessAccount.mockReset();
  verifyOtp.mockClear();
});

describe("POST /api/access", () => {
  it("refuses when code sign-in is off", async () => {
    enabled = false;
    const res = await post({ code: "x" });
    expect(res.status).toBe(403);
    expect(prepareAccessAccount).not.toHaveBeenCalled();
  });

  it("throttles before it checks the code", async () => {
    allow = false;
    matches = true;
    expect((await post({ code: "x" })).status).toBe(429);
    expect(prepareAccessAccount).not.toHaveBeenCalled();
  });

  it("turns a wrong code away without opening the account", async () => {
    const res = await post({ code: "WRONG" });
    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe("wrong-code");
    expect(prepareAccessAccount).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("signs a right code into the account and sends it to the admin panel", async () => {
    matches = true;
    prepareAccessAccount.mockResolvedValueOnce({ ok: true, userId: "u", tokenHash: "h", type: "magiclink" });
    const res = await post({ code: "RIGHT" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "/admin" });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "h", type: "magiclink" });
  });

  it("says so when the account cannot be opened or the session fails", async () => {
    matches = true;
    prepareAccessAccount.mockResolvedValueOnce({ ok: false, detail: "no keys" });
    expect((await post({ code: "RIGHT" })).status).toBe(503);
    prepareAccessAccount.mockResolvedValueOnce({ ok: true, userId: "u", tokenHash: "h", type: "magiclink" });
    verifyOtp.mockResolvedValueOnce({ error: { message: "token expired" } } as never);
    const res = await post({ code: "RIGHT" });
    expect(res.status).toBe(502);
    expect((await res.json()).message).toContain("token expired");
  });

  it("treats a missing or malformed body as a wrong code", async () => {
    const res = await POST(new Request("https://x/api/access", { method: "POST", body: "not json" }));
    expect(res.status).toBe(401);
  });
});
