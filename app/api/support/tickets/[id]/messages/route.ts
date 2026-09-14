/**
 * A reply on a ticket:  POST /api/support/tickets/[id]/messages
 *
 * The author's role is taken from the gate, never from the body. A
 * member cannot post as staff by asking to, and `internal: true` from a
 * member is refused rather than quietly downgraded — a person who
 * believed they were writing a private note deserves to be told they
 * were not, and no member has a reason to send that flag at all.
 */

import { NextResponse } from "next/server";
import { requireSupportActor } from "@/lib/auth/gate";
import { notifyMember, notifyStaff } from "@/lib/support/notify";
import { addMessage, readMemberName, readTicket } from "@/lib/support/store";
import {
  canNote,
  canRead,
  canReply,
  cleanText,
  MAX_BODY,
  type Actor,
} from "@/lib/support/ticket";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const who = await requireSupportActor();
  if (!who.ok) return who.response;
  const actor: Actor = { userId: who.user.id, staff: who.staff };
  const { id } = await ctx.params;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const message = cleanText(body?.body, MAX_BODY, true);
  const wantsInternal = body?.internal === true;
  if (!message) {
    return NextResponse.json(
      { ok: false, reason: "bad-request", hint: `body: 1–${MAX_BODY} characters` },
      { status: 400 }
    );
  }

  const read = await readTicket(id);
  if (!read.ok) {
    return NextResponse.json(
      { ok: false, reason: "store", detail: read.detail },
      { status: 502 }
    );
  }
  // Same 404 for "gone" and "not yours" — see the GET handler.
  if (!read.data || !canRead(read.data.ticket, actor)) {
    return NextResponse.json({ ok: false, reason: "not-found" }, { status: 404 });
  }
  const ticket = read.data.ticket;

  if (wantsInternal && !canNote(ticket, actor)) {
    return NextResponse.json(
      { ok: false, reason: "not-allowed", hint: "internal note" },
      { status: 403 }
    );
  }
  if (!wantsInternal && !canReply(ticket, actor)) {
    return NextResponse.json(
      { ok: false, reason: "closed", hint: "reopen the ticket before replying" },
      { status: 409 }
    );
  }

  const name =
    (await readMemberName(who.user.id).catch(() => null)) ??
    (typeof who.user.user_metadata?.full_name === "string"
      ? who.user.user_metadata.full_name
      : null) ??
    who.user.email ??
    null;

  const added = await addMessage(ticket, {
    authorId: who.user.id,
    authorRole: actor.staff ? "staff" : "user",
    authorName: name,
    body: message,
    internal: wantsInternal,
  });
  if (!added.ok) {
    return NextResponse.json(
      { ok: false, reason: "store", detail: added.detail },
      { status: 502 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;
  // An internal note tells nobody: that is the entire point of it.
  if (!wantsInternal) {
    if (actor.staff) void notifyMember(added.data.ticket, message, appUrl);
    else void notifyStaff(added.data.ticket, message, appUrl, false);
  }

  return NextResponse.json(
    { ok: true, message: added.data.message, ticket: added.data.ticket },
    { status: 201 }
  );
}
