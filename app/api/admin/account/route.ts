/**
 * Acting on somebody else's account:  POST /api/admin/account
 *
 * The most dangerous route in the product. A password set here IS the
 * account, so three rules hold and the first line of the handler is
 * the one that enforces them.
 *
 * ONE GATE, FAILING CLOSED. requireAccountAdmin — an address named in
 * ADMIN_EMAILS with a confirmed mailbox, and NOBODY AT ALL when that
 * variable is unset. Deliberately not requireStaff, which opens to
 * every signed-in account when the list is empty: that default is
 * right for a page of totals and would be account takeover here,
 * because the signup form is open. Deliberately not requireOperator
 * either — that one accepts CRON_SECRET in a query string, and a URL
 * that can change a password does not belong in a log file.
 *
 * NOBODY ACTS ON THEMSELVES BY ACCIDENT. An admin may grant their own
 * account credits or change their own plan; they may not set their own
 * password or move their own address through this route. Those two
 * have their own front-door flows, and the failure mode here — a
 * misdirected write against the session that is making it — locks the
 * operator out of the tool they would use to fix it.
 *
 * THE ANSWER NEVER CARRIES THE SECRET. A password goes to the auth
 * server and is not echoed, stored or logged; the response says
 * whether it worked and nothing more.
 */

import { NextResponse } from "next/server";
import { requireAccountAdmin } from "@/lib/auth/gate";
import {
  grantCredits,
  sendPasswordReset,
  setAccountTier,
  setEmail,
  setPassword,
} from "@/lib/admin/accounts";
import { TIERS, type TierId } from "@/config/app";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The things an admin can do to an account, named so the client and
 *  the handler cannot drift. */
const ACTIONS = ["set-password", "set-email", "send-reset", "grant-credits", "set-tier"] as const;
type Action = (typeof ACTIONS)[number];

/** The two that must never land on the caller's own account — see the
 *  header. Granting yourself credits is auditable and reversible;
 *  setting your own password through the admin door is neither. */
const NOT_ON_SELF = new Set<Action>(["set-password", "set-email"]);

const bad = (detail: string, status = 400) =>
  NextResponse.json({ ok: false, detail }, { status });

export async function POST(request: Request) {
  const gate = await requireAccountAdmin();
  if (!gate.ok) return gate.response;
  const by = gate.user.email ?? gate.user.id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("Send a JSON body");
  }
  const input = (body ?? {}) as {
    action?: string;
    userId?: string;
    email?: string;
    password?: string;
    amount?: number;
    tier?: string;
  };

  const action = input.action as Action | undefined;
  if (!action || !ACTIONS.includes(action)) return bad("Unknown action");

  const userId = (input.userId ?? "").trim();
  if (!userId) return bad("Which account?");
  if (NOT_ON_SELF.has(action) && userId === gate.user.id) {
    return bad(
      "Change your own password or address from your account settings, not from here.",
      409
    );
  }

  switch (action) {
    case "set-password": {
      const out = await setPassword(userId, input.password ?? "");
      // The password is not in `out` and must not enter the response
      // by any other door either.
      return NextResponse.json(out, { status: out.ok ? 200 : 400 });
    }
    case "set-email": {
      // Carries `warning` when the login moved but the directory copy
      // did not — a 200 the client still has to say something about.
      const out = await setEmail(userId, input.email ?? "");
      return NextResponse.json(out, { status: out.ok ? 200 : 400 });
    }
    case "send-reset": {
      const email = (input.email ?? "").trim();
      if (!email) return bad("No address on file for this account");
      const out = await sendPasswordReset(email);
      return NextResponse.json(out, { status: out.ok ? 200 : 400 });
    }
    case "grant-credits": {
      const out = await grantCredits(userId, Number(input.amount), by);
      return NextResponse.json(out, { status: out.ok ? 200 : 400 });
    }
    case "set-tier": {
      const tier = input.tier as TierId | undefined;
      if (!tier || !(tier in TIERS)) return bad("Unknown plan");
      const out = await setAccountTier(userId, tier);
      return NextResponse.json(
        { ok: out.ok, detail: out.ok ? TIERS[tier].name : (out.detail ?? "Could not set the plan") },
        { status: out.ok ? 200 : 400 }
      );
    }
  }
}
