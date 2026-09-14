/**
 * One ticket and its thread:  GET   /api/support/tickets/[id]
 * Status and priority:        PATCH /api/support/tickets/[id]
 *
 * NOT FOUND, NOT FORBIDDEN. A ticket the caller may not read answers
 * 404 rather than 403, because 403 confirms that the id exists — and
 * with sequential guessing off the table (these are uuids) the only
 * thing a 403 could tell someone is that they found a real ticket.
 * Same answer for "no such ticket" and "not yours".
 */

import { NextResponse } from "next/server";
import { requireSupportActor } from "@/lib/auth/gate";
import { markRead, patchTicket, readTicket } from "@/lib/support/store";
import {
  allowedStatuses,
  asPriority,
  asStatus,
  canRead,
  canReply,
  canSetPriority,
  canSetStatus,
  visibleMessages,
  type Actor,
} from "@/lib/support/ticket";

export const dynamic = "force-dynamic";

const missing = () =>
  NextResponse.json({ ok: false, reason: "not-found" }, { status: 404 });

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const who = await requireSupportActor();
  if (!who.ok) return who.response;
  const actor: Actor = { userId: who.user.id, staff: who.staff };
  const { id } = await ctx.params;

  const read = await readTicket(id);
  if (!read.ok) {
    return NextResponse.json(
      { ok: false, reason: "store", detail: read.detail },
      { status: 502 }
    );
  }
  if (!read.data || !canRead(read.data.ticket, actor)) return missing();

  // Opening the thread is what clears this side's dot. Best effort —
  // see markRead — so a store hiccup costs a badge, not the page.
  const ticket = await markRead(read.data.ticket, actor);

  return NextResponse.json({
    ok: true,
    staff: who.staff,
    ticket,
    messages: visibleMessages(read.data.messages, actor),
    can: {
      reply: canReply(ticket, actor),
      note: actor.staff && ticket.status !== "closed",
      priority: canSetPriority(actor),
      statuses: allowedStatuses(ticket, actor),
    },
  });
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const who = await requireSupportActor();
  if (!who.ok) return who.response;
  const actor: Actor = { userId: who.user.id, staff: who.staff };
  const { id } = await ctx.params;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const nextStatus = asStatus(body?.status);
  const nextPriority = asPriority(body?.priority);
  if (!nextStatus && !nextPriority) {
    return NextResponse.json(
      { ok: false, reason: "bad-request", hint: "status and/or priority" },
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
  if (!read.data || !canRead(read.data.ticket, actor)) return missing();
  const current = read.data.ticket;

  // Each field is checked on its own: a member sending both a legal
  // status and a priority they may not set gets neither, rather than
  // the half that happened to be checked first.
  if (nextStatus && !canSetStatus(current, actor, nextStatus)) {
    return NextResponse.json(
      { ok: false, reason: "not-allowed", hint: "status", allowed: allowedStatuses(current, actor) },
      { status: 403 }
    );
  }
  if (nextPriority && !canSetPriority(actor)) {
    return NextResponse.json(
      { ok: false, reason: "not-allowed", hint: "priority" },
      { status: 403 }
    );
  }

  const patched = await patchTicket(id, {
    ...(nextStatus ? { status: nextStatus } : {}),
    ...(nextPriority ? { priority: nextPriority } : {}),
    // Reopening puts it back in front of the team; closing or resolving
    // is the team's own act and needs no dot of its own.
    ...(nextStatus === "open" && !actor.staff ? { unreadForStaff: true } : {}),
    ...(nextStatus && nextStatus !== "open" && actor.staff ? { unreadForUser: true } : {}),
  });
  if (!patched.ok) {
    return NextResponse.json(
      { ok: false, reason: "store", detail: patched.detail },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    ticket: patched.data,
    can: {
      reply: canReply(patched.data, actor),
      note: actor.staff && patched.data.status !== "closed",
      priority: canSetPriority(actor),
      statuses: allowedStatuses(patched.data, actor),
    },
  });
}
