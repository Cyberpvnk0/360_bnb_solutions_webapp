/**
 * Acting on somebody else's account.
 *
 * Setting a password, moving an address, handing out credits: every
 * one of these is a thing the account's owner would otherwise have to
 * do themselves, done for them because they asked support to. Which
 * means this module is the most dangerous code in the product — a
 * password set here IS the account.
 *
 * Three rules follow from that, and they are enforced rather than
 * documented:
 *
 * 1. NOTHING HERE AUTHORISES ANYTHING. The route decides who may call
 *    it, through requireAccountAdmin, which is the fail-closed gate:
 *    an address named in ADMIN_EMAILS, confirmed, and nobody at all
 *    when that variable is unset.
 * 2. EVERY CREDIT GRANT LEAVES A RECORD. credit_ledger already takes a
 *    reason and a reference, so a grant carries who did it and when,
 *    and the reference makes a double-click hand out one grant rather
 *    than two.
 * 3. THE ADMIN NEVER LEARNS THE PASSWORD THEY SET. It goes to the auth
 *    server and is not echoed back, stored, or logged here — the point
 *    of the feature is to unstick somebody, not to hold their key.
 *
 * All of it runs on the secret key, server-side only.
 */

import { serviceConfig } from "@/lib/db/service";
import { setTier, type SetTierResult } from "@/lib/db/usage";
import type { TierId } from "@/config/app";

const TIMEOUT_MS = 10_000;

export type AdminActionResult =
  | {
      ok: true;
      detail?: string;
      /** The action did what it said, but something alongside it did
       *  not — see setEmail. Shown to the admin rather than swallowed,
       *  because a half-done change to somebody's account is the one
       *  they most need to know about. */
      warning?: string;
    }
  | { ok: false; detail: string };

/** The auth server's admin interface, as the service. */
async function authAdmin(
  path: string,
  init: { method: string; body?: unknown }
): Promise<AdminActionResult> {
  const cfg = serviceConfig();
  if (!cfg) return { ok: false, detail: "no store configured" };
  try {
    const res = await fetch(`${cfg.url}/auth/v1/${path}`, {
      method: init.method,
      headers: {
        apikey: cfg.key,
        authorization: `Bearer ${cfg.key}`,
        "content-type": "application/json",
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) return { ok: true };
    // The auth server explains itself in JSON; pass that through rather
    // than a status, because "email address is invalid" and "user not
    // found" need different things done about them.
    const body = (await res.text().catch(() => "")).slice(0, 300);
    let detail = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(body) as { msg?: string; message?: string; error_description?: string };
      detail = parsed.msg ?? parsed.message ?? parsed.error_description ?? detail;
    } catch {
      if (body) detail = body;
    }
    return { ok: false, detail };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 200) : "unreachable",
    };
  }
}

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 72;

/**
 * Set an account's password.
 *
 * For the case support actually meets: somebody locked out whose reset
 * mail is not arriving. Prefer sendPasswordReset — that one leaves the
 * password known only to its owner. This exists because "the email
 * never comes" is a real dead end and a person stuck outside their own
 * account does not care about the theory.
 */
export async function setPassword(
  userId: string,
  password: string
): Promise<AdminActionResult> {
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    return { ok: false, detail: `Password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters` };
  }
  return authAdmin(`admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: { password },
  });
}

/**
 * Move an account to a different address.
 *
 * Confirmed on the spot: an admin doing this is fixing a typo or a
 * change of employer for somebody who has already proved who they are,
 * and leaving the new address unconfirmed would lock them out of the
 * thing that was meant to help. The profile row carries its own copy
 * of the address for the queue to read, so that is updated too — a
 * ticket raised afterwards should not still show the old one.
 */
export async function setEmail(
  userId: string,
  email: string
): Promise<AdminActionResult> {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) {
    return { ok: false, detail: "That does not look like an email address" };
  }
  const changed = await authAdmin(`admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: { email: clean, email_confirm: true },
  });
  if (!changed.ok) return changed;

  const cfg = serviceConfig();
  if (cfg) {
    // NOT best effort, whatever the first version of this said. The
    // login moved the moment the call above succeeded, but every admin
    // surface reads the address out of the profile row — so a patch
    // that quietly fails leaves the table, the drawer and, worst of
    // all, the Send reset email button pointed at an address the
    // account no longer has. That button would then report success for
    // mail nobody can receive, because the recovery endpoint answers
    // 200 for an address it does not know.
    const synced = await fetch(
      `${cfg.url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: cfg.key,
          authorization: `Bearer ${cfg.key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: clean, updated_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      }
    )
      .then((r) => r.ok)
      .catch(() => false);
    if (!synced) {
      return {
        ok: true,
        detail: clean,
        warning: `They sign in as ${clean} now, but the directory copy did not update — it will keep showing the old address, and Send reset email would go to it. Try the change again.`,
      };
    }
  }
  return { ok: true, detail: clean };
}

/**
 * Send the account its own reset link.
 *
 * The public recovery endpoint rather than the admin one, because this
 * is the path that actually posts mail — admin/generate_link returns a
 * link for someone to forward by hand, which is a worse answer and one
 * more place for the link to sit around. Takes the publishable key, as
 * a signed-out visitor would.
 */
export async function sendPasswordReset(email: string): Promise<AdminActionResult> {
  const cfg = serviceConfig();
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!cfg || !anon) return { ok: false, detail: "no store configured" };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  try {
    const res = await fetch(`${cfg.url}/auth/v1/recover`, {
      method: "POST",
      headers: { apikey: anon, "content-type": "application/json" },
      body: JSON.stringify({
        email,
        ...(appUrl ? { gotrue_meta_security: {}, redirect_to: `${appUrl}/auth/callback` } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) return { ok: true };
    const body = (await res.text().catch(() => "")).slice(0, 200);
    return { ok: false, detail: body || `HTTP ${res.status}` };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 200) : "unreachable",
    };
  }
}

export const MAX_GRANT = 10_000;

/**
 * Hand an account credits, with a reason attached.
 *
 * Straight to the same ledger a purchase writes to, so the balance has
 * one history and a granted credit is as auditable as a bought one.
 * The reference carries the admin and the minute, which also makes the
 * grant idempotent: a double-clicked button inside the same minute
 * lands once, and the second call reports the balance unchanged.
 */
export async function grantCredits(
  userId: string,
  amount: number,
  by: string
): Promise<{ ok: boolean; balance: number; granted: boolean; detail: string | null }> {
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_GRANT) {
    return { ok: false, balance: 0, granted: false, detail: `1–${MAX_GRANT} credits` };
  }
  const cfg = serviceConfig();
  if (!cfg) return { ok: false, balance: 0, granted: false, detail: "no store configured" };
  const minute = new Date().toISOString().slice(0, 16);
  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/grant_credits`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        authorization: `Bearer ${cfg.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_user: userId,
        p_amount: amount,
        p_reason: `admin grant by ${by}`,
        p_ref: `admin:${by}:${userId}:${amount}:${minute}`,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, balance: 0, granted: false, detail: detail || `HTTP ${res.status}` };
    }
    const rows = (await res.json()) as { balance?: number; granted?: boolean }[];
    const row = rows?.[0];
    return {
      ok: true,
      balance: typeof row?.balance === "number" ? row.balance : 0,
      granted: row?.granted === true,
      detail: null,
    };
  } catch (e) {
    return {
      ok: false,
      balance: 0,
      granted: false,
      detail: e instanceof Error ? e.message.slice(0, 200) : "unreachable",
    };
  }
}

/** Put the account on a plan. The existing writer — one place a tier
 *  changes, whether the checkout or an admin asked for it. */
export function setAccountTier(userId: string, tier: TierId): Promise<SetTierResult> {
  return setTier(userId, tier);
}

/**
 * NOT HERE: ending an account's other sessions.
 *
 * Changing a password does not invalidate refresh tokens the auth
 * server has already issued, so somebody signed in stays signed in.
 * The admin endpoint for revoking them varies by auth-server version
 * and could not be verified against this deployment, so rather than
 * ship a call that might quietly do nothing, the drawer says plainly
 * that nothing on it ends a session already open.
 *
 * Changing the address is NOT a workaround, whatever it does on other
 * auth servers — it was never verified here either, and an admin
 * acting on a compromised account needs to know what actually
 * happened rather than a plausible story about it.
 */
