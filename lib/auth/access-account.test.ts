import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The account the access code opens: created once, made an admin by a
 * server-only flag, put on the top plan, given one welcome grant ever,
 * and signed into with a one-time token rather than a password.
 */

const generateLink = vi.fn();
const updateUserById = vi.fn(async () => ({ data: {}, error: null }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { admin: { generateLink, updateUserById } } }),
}));
const setTier = vi.fn(async () => ({ ok: true, tier: "scale", detail: null }));
vi.mock("@/lib/db/usage", () => ({ setTier: (...a: unknown[]) => setTier(...(a as [])) }));
const grantCredits = vi.fn(async () => ({ ok: true, balance: 500, granted: true, detail: null }));
vi.mock("@/lib/admin/accounts", () => ({ grantCredits: (...a: unknown[]) => grantCredits(...(a as [])) }));
vi.mock("@/lib/db/service", () => ({
  serviceConfig: () => (process.env.SUPABASE_URL ? { url: process.env.SUPABASE_URL, key: "secret" } : null),
}));
vi.mock("@/lib/auth/gate", () => ({
  adminEmails: (env = process.env.ADMIN_EMAILS) =>
    new Set((env ?? "").split(",").map((e: string) => e.trim().toLowerCase()).filter(Boolean)),
}));

import { accessAccountEmail, prepareAccessAccount, WELCOME_CREDITS } from "./access-account";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
  vi.stubEnv("ADMIN_EMAILS", "Owner@Example.com, other@example.com");
  vi.stubEnv("ACCESS_CODE_ACCOUNT_EMAIL", "");
  generateLink.mockReset();
  updateUserById.mockClear();
  setTier.mockClear();
  grantCredits.mockClear();
});

describe("accessAccountEmail", () => {
  it("adds +counsel to the first admin's address", () => {
    expect(accessAccountEmail(env({ ADMIN_EMAILS: "Owner@Example.com,b@c.io" }))).toBe("owner+counsel@example.com");
    expect(accessAccountEmail(env({ ADMIN_EMAILS: "owner+ops@example.com" }))).toBe("owner+counsel@example.com");
  });

  it("prefers an explicit address and has none to give without either", () => {
    expect(accessAccountEmail(env({ ACCESS_CODE_ACCOUNT_EMAIL: "Counsel@Firm.law", ADMIN_EMAILS: "a@b.co" }))).toBe("counsel@firm.law");
    expect(accessAccountEmail(env({ ACCESS_CODE_ACCOUNT_EMAIL: "not-an-email" }))).toBeNull();
    expect(accessAccountEmail(env({}))).toBeNull();
  });
});

const linkFor = (app_metadata: Record<string, unknown>, verification_type = "magiclink") => ({
  data: {
    user: { id: "user-1", app_metadata },
    properties: { hashed_token: "hashed-123", verification_type },
  },
  error: null,
});

describe("prepareAccessAccount", () => {
  it("flags a new account admin, puts it on Scale, grants once, and hands back the token", async () => {
    generateLink.mockResolvedValueOnce(linkFor({ provider: "email" }, "signup"));
    const r = await prepareAccessAccount();
    expect(r).toEqual({ ok: true, userId: "user-1", tokenHash: "hashed-123", type: "signup" });
    expect(generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "owner+counsel@example.com" });
    expect(updateUserById).toHaveBeenCalledWith("user-1", { app_metadata: { aircore_role: "admin" } });
    expect(setTier).toHaveBeenCalledWith("user-1", "scale");
    expect(grantCredits).toHaveBeenCalledWith("user-1", WELCOME_CREDITS, "access-code", {
      reason: "access-code account welcome grant",
      ref: "access-code:welcome:user-1",
    });
  });

  it("leaves an already-flagged account's metadata alone", async () => {
    generateLink.mockResolvedValueOnce(linkFor({ aircore_role: "admin" }));
    const r = await prepareAccessAccount();
    expect(r.ok).toBe(true);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("says what is missing rather than guessing", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    expect(await prepareAccessAccount()).toEqual({ ok: false, detail: "the server's store keys are not set" });
    vi.stubEnv("SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("ADMIN_EMAILS", "");
    expect((await prepareAccessAccount()).ok).toBe(false);
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("reports an auth server that issues no token", async () => {
    generateLink.mockResolvedValueOnce({ data: null, error: { message: "rate limited" } });
    expect(await prepareAccessAccount()).toEqual({ ok: false, detail: "rate limited" });
  });

  it("still signs in when the plan or the grant stumbles", async () => {
    generateLink.mockResolvedValueOnce(linkFor({ aircore_role: "admin" }));
    setTier.mockRejectedValueOnce(new Error("down"));
    grantCredits.mockRejectedValueOnce(new Error("down"));
    expect((await prepareAccessAccount()).ok).toBe(true);
  });
});
