/**
 * The account an access code opens.
 *
 * WHY A REAL ACCOUNT. Everything a member does here hangs off a real
 * auth user: saved lists, the pipeline, credits, support tickets, all
 * of it read through row-level security keyed to that user's id. A
 * code that opened some looser "admin mode" would open an admin panel
 * and nothing else. So the code signs its holder into one dedicated
 * account, and that account can do everything.
 *
 * HOW, WITHOUT A PASSWORD. With the secret key the server asks the auth
 * server for a one-time sign-in token for that account — the same token
 * a magic-link email would carry — and redeems it on the spot, which
 * sets an ordinary session cookie. No email is sent and no password
 * exists to leak.
 *
 * WHAT IT IS GIVEN, every time the code is used (all idempotent):
 *   - app_metadata.aircore_role = "admin", which the gates honour. Only
 *     the secret key can write app_metadata, so no member can grant
 *     themselves this.
 *   - the top plan, Scale, so every feature is switched on;
 *   - one welcome grant of WELCOME_CREDITS, once ever, so an audit does
 *     not stall on a monthly meter.
 *
 * THE ADDRESS. The account needs an email to exist, though nothing is
 * ever sent to it. ACCESS_CODE_ACCOUNT_EMAIL sets it; otherwise it is
 * the first admin's address with "+counsel" added, which is a real
 * mailbox the owner already controls and one the auth server accepts.
 *
 * Server only: it uses the secret key.
 */

import { createClient, type EmailOtpType } from "@supabase/supabase-js";
import { grantCredits } from "@/lib/admin/accounts";
import { ACCESS_ROLE, ACCESS_ROLE_KEY } from "@/lib/auth/access-code";
import { adminEmails } from "@/lib/auth/gate";
import { serviceConfig } from "@/lib/db/service";
import { setTier } from "@/lib/db/usage";

export const WELCOME_CREDITS = 500;

/** The account's address, or null when there is nothing to derive it from. */
export function accessAccountEmail(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.ACCESS_CODE_ACCOUNT_EMAIL?.trim().toLowerCase();
  if (explicit && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(explicit)) return explicit;
  // `?? ""`: undefined would fall through to adminEmails' own default
  // and read the real environment instead of the one passed in.
  const first = [...adminEmails(env.ADMIN_EMAILS ?? "")][0];
  const m = first ? /^([^@+\s]+)(?:\+[^@\s]*)?@([^@\s]+\.[^@\s]+)$/.exec(first) : null;
  return m ? `${m[1]}+counsel@${m[2]}` : null;
}

export type PreparedSession =
  | { ok: true; userId: string; tokenHash: string; type: EmailOtpType }
  | { ok: false; detail: string };

/**
 * Make sure the account exists and is an admin on the top plan, and
 * mint a one-time token that signs into it.
 */
export async function prepareAccessAccount(): Promise<PreparedSession> {
  const cfg = serviceConfig();
  if (!cfg) return { ok: false, detail: "the server's store keys are not set" };
  const email = accessAccountEmail();
  if (!email) {
    return { ok: false, detail: "set ACCESS_CODE_ACCOUNT_EMAIL (or ADMIN_EMAILS) so the account has an address" };
  }

  const admin = createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Creates the account on first use; on every later use, finds it.
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error || !link.data?.user || !link.data.properties?.hashed_token) {
    return { ok: false, detail: link.error?.message ?? "the auth server issued no sign-in token" };
  }
  const user = link.data.user;

  if (user.app_metadata?.[ACCESS_ROLE_KEY] !== ACCESS_ROLE) {
    // app_metadata only: confirming the email here would spend the token
    // just issued, and redeeming it confirms the address anyway.
    const updated = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { [ACCESS_ROLE_KEY]: ACCESS_ROLE },
    });
    if (updated.error) return { ok: false, detail: `could not mark the account admin: ${updated.error.message}` };
  }

  // Both idempotent, and neither blocks the sign-in if it stumbles: the
  // beta default plan is already Scale, and the grant only adds headroom.
  await Promise.all([
    setTier(user.id, "scale").catch(() => null),
    grantCredits(user.id, WELCOME_CREDITS, "access-code", {
      reason: "access-code account welcome grant",
      ref: `access-code:welcome:${user.id}`,
    }).catch(() => null),
  ]);

  return {
    ok: true,
    userId: user.id,
    tokenHash: link.data.properties.hashed_token,
    // An account that has never signed in gets a sign-up token rather
    // than a magic-link one; the auth server says which it issued.
    type: (link.data.properties.verification_type ?? "magiclink") as EmailOtpType,
  };
}
