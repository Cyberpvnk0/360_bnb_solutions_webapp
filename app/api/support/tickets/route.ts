/**
 * The caller's tickets:  GET /api/support/tickets
 * A new one:             POST /api/support/tickets
 *
 * One route, two audiences. A member gets the tickets they raised; a
 * member of staff gets those too, and `?scope=all` for the whole queue.
 * Which of the two the caller is comes from lib/auth/gate and nowhere
 * else — there is no header, body field or query parameter that makes
 * anyone staff, and `scope=all` from a member is simply ignored rather
 * than refused, because a member asking for it has done nothing wrong.
 */

import { NextResponse } from "next/server";
import { requireSupportActor } from "@/lib/auth/gate";
import { notifyStaff } from "@/lib/support/notify";
import { createTicket, listTickets, readMemberName } from "@/lib/support/store";
import {
  asCategory,
  asStatus,
  cleanText,
  MAX_BODY,
  MAX_SUBJECT,
  queueOrder,
  unreadCount,
  type Actor,
} from "@/lib/support/ticket";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const who = await requireSupportActor();
  if (!who.ok) return who.response;
  const actor: Actor = { userId: who.user.id, staff: who.staff };

  const params = new URL(request.url).searchParams;
  const rawStatus = params.get("status");
  const status =
    rawStatus === "live" || rawStatus === "all" ? rawStatus : (asStatus(rawStatus) ?? "all");

  const result = await listTickets(actor, {
    scope: params.get("scope") === "all" ? "all" : "mine",
    status,
    search: params.get("q") ?? undefined,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: "store", detail: result.detail },
      { status: 502 }
    );
  }

  // Counted over what came back rather than asked for separately: the
  // badge and the list then always agree, which they did not when the
  // count was its own query against its own filter.
  return NextResponse.json({
    ok: true,
    staff: who.staff,
    tickets: queueOrder(result.data),
    unread: unreadCount(result.data, actor),
  });
}

export async function POST(request: Request) {
  const who = await requireSupportActor();
  if (!who.ok) return who.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const subject = cleanText(body?.subject, MAX_SUBJECT);
  const message = cleanText(body?.message, MAX_BODY, true);
  const category = asCategory(body?.category) ?? "other";

  if (!subject || !message) {
    return NextResponse.json(
      {
        ok: false,
        reason: "bad-request",
        hint: `subject: 1–${MAX_SUBJECT} characters; message: 1–${MAX_BODY}`,
      },
      { status: 400 }
    );
  }

  // The name as the account knows it, so the queue reads as people
  // rather than as user ids. A profile that cannot be read is not a
  // reason to refuse the ticket — the address alone identifies them.
  const name =
    (await readMemberName(who.user.id).catch(() => null)) ??
    (typeof who.user.user_metadata?.full_name === "string"
      ? who.user.user_metadata.full_name
      : null);

  const created = await createTicket({
    userId: who.user.id,
    userEmail: who.user.email ?? null,
    userName: name,
    subject,
    category,
    body: message,
  });
  if (!created.ok) {
    return NextResponse.json(
      { ok: false, reason: "store", detail: created.detail },
      { status: 502 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;
  // Not awaited into the response: the ticket exists either way, and a
  // slow mail API must not make the person think their ticket failed.
  void notifyStaff(created.data, message, appUrl, true);

  return NextResponse.json({ ok: true, ticket: created.data }, { status: 201 });
}
