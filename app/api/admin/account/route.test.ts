import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The route that can take an account away from the person who owns it.
 *
 * These are about the REFUSALS, not the happy path: the underlying
 * writers are already covered in lib/admin/accounts.test, and what
 * matters here is that nothing reaches them it should not. A route
 * that sets passwords has to fail in exactly the ways it says it does.
 */

const admin = { id: "admin-1", email: "boss@example.com", email_confirmed_at: "2026-01-01" };
let gateAnswer: { ok: boolean; user?: typeof admin; response?: Response } = {
  ok: true,
  user: admin,
};

vi.mock("@/lib/auth/gate", () => ({
  requireAccountAdmin: vi.fn(async () => gateAnswer),
}));

const setPassword = vi.fn(async () => ({ ok: true }));
const setEmail = vi.fn(async () => ({ ok: true, detail: "new@example.com" }));
const sendPasswordReset = vi.fn(async () => ({ ok: true }));
const grantCredits = vi.fn(async () => ({ ok: true, balance: 25, granted: true, detail: null }));
const setAccountTier = vi.fn(async () => ({ ok: true, tier: "pro", detail: null }));

vi.mock("@/lib/admin/accounts", () => ({
  setPassword: (...a: unknown[]) => setPassword(...(a as [])),
  setEmail: (...a: unknown[]) => setEmail(...(a as [])),
  sendPasswordReset: (...a: unknown[]) => sendPasswordReset(...(a as [])),
  grantCredits: (...a: unknown[]) => grantCredits(...(a as [])),
  setAccountTier: (...a: unknown[]) => setAccountTier(...(a as [])),
  MIN_PASSWORD: 8,
  MAX_PASSWORD: 72,
  MAX_GRANT: 10_000,
}));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new Request("https://x/api/admin/account", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

beforeEach(() => {
  gateAnswer = { ok: true, user: admin };
  vi.clearAllMocks();
});

describe("who may call it", () => {
  it("hands back the gate's own refusal, untouched", async () => {
    gateAnswer = {
      ok: false,
      response: new Response(JSON.stringify({ reason: "admin-only" }), { status: 403 }),
    } as never;
    const res = await post({ action: "send-reset", userId: "u-2", email: "a@b.co" });
    expect(res.status).toBe(403);
    expect(sendPasswordReset).not.toHaveBeenCalled();
  });
});

describe("what it will act on", () => {
  it.each([
    ["no action", { userId: "u-2" }],
    ["an action it does not have", { action: "delete-account", userId: "u-2" }],
    ["no account", { action: "send-reset", email: "a@b.co" }],
    ["a blank account", { action: "send-reset", userId: "   ", email: "a@b.co" }],
  ])("refuses %s", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(sendPasswordReset).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON rather than throwing", async () => {
    const res = await post("<not json>");
    expect(res.status).toBe(400);
  });

  it("refuses a plan it has never heard of", async () => {
    const res = await post({ action: "set-tier", userId: "u-2", tier: "platinum" });
    expect(res.status).toBe(400);
    expect(setAccountTier).not.toHaveBeenCalled();
  });

  it("refuses a reset with no address to send it to", async () => {
    const res = await post({ action: "send-reset", userId: "u-2", email: "  " });
    expect(res.status).toBe(400);
    expect(sendPasswordReset).not.toHaveBeenCalled();
  });
});

/**
 * The rule that matters most in practice. An admin who fat-fingers
 * their own row and sets a password on it locks themselves out of the
 * one tool they would use to undo it.
 */
describe("acting on your own account", () => {
  it("refuses to set your own password from here", async () => {
    const res = await post({ action: "set-password", userId: admin.id, password: "longenough1" });
    expect(res.status).toBe(409);
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("refuses to move your own address from here", async () => {
    const res = await post({ action: "set-email", userId: admin.id, email: "me@elsewhere.com" });
    expect(res.status).toBe(409);
    expect(setEmail).not.toHaveBeenCalled();
  });

  it("still lets you grant yourself credits — auditable and reversible", async () => {
    const res = await post({ action: "grant-credits", userId: admin.id, amount: 5 });
    expect(res.status).toBe(200);
    expect(grantCredits).toHaveBeenCalledWith(admin.id, 5, admin.email);
  });

  it("still lets you move your own plan", async () => {
    const res = await post({ action: "set-tier", userId: admin.id, tier: "pro" });
    expect(res.status).toBe(200);
  });

  it("allows both on SOMEBODY ELSE, which is the whole point", async () => {
    expect(
      (await post({ action: "set-password", userId: "u-2", password: "longenough1" })).status
    ).toBe(200);
    expect(
      (await post({ action: "set-email", userId: "u-2", email: "new@example.com" })).status
    ).toBe(200);
  });
});

describe("what comes back", () => {
  it("never echoes the password, in any field", async () => {
    const secret = "correct-horse-battery-staple";
    const res = await post({ action: "set-password", userId: "u-2", password: secret });
    expect(await res.text()).not.toContain(secret);
  });

  it("names the admin on the credit grant, so the ledger says who", async () => {
    await post({ action: "grant-credits", userId: "u-2", amount: 40 });
    expect(grantCredits).toHaveBeenCalledWith("u-2", 40, admin.email);
  });

  it("passes a refusal from the writer through as a 400", async () => {
    setPassword.mockResolvedValueOnce({ ok: false, detail: "too short" } as never);
    const res = await post({ action: "set-password", userId: "u-2", password: "x" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, detail: "too short" });
  });
});
