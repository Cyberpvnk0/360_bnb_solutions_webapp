/**
 * /support/[id] — one ticket, rendered on the server.
 *
 * The thread is read here rather than fetched by the client so the
 * conversation is on screen in the first paint and so the authorisation
 * happens once, before anything is sent: a ticket this account may not
 * read is notFound() and no part of it reaches the browser. The client
 * component takes over for replies.
 */

import { notFound } from "next/navigation";
import { isSupportStaff } from "@/lib/auth/gate";
import { currentUser } from "@/lib/supabase/server";
import { markRead, readTicket } from "@/lib/support/store";
import {
  allowedStatuses,
  canNote,
  canRead,
  canReply,
  canSetPriority,
  visibleMessages,
  type Actor,
} from "@/lib/support/ticket";
import { TicketThread } from "@/components/support/ticket-thread";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) return { title: "Support" };
  const { id } = await params;
  const read = await readTicket(id).catch(() => null);
  const actor: Actor = { userId: user.id, staff: isSupportStaff(user) };
  // A title is a disclosure too: a ticket this account may not read
  // must not name itself in the browser tab.
  if (!read?.ok || !read.data || !canRead(read.data.ticket, actor)) {
    return { title: "Support" };
  }
  return { title: `${read.data.ticket.subject} · ${read.data.ticket.ref}` };
}

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) notFound();
  const { id } = await params;

  const read = await readTicket(id).catch(() => null);
  const actor: Actor = { userId: user.id, staff: isSupportStaff(user) };
  if (!read?.ok || !read.data || !canRead(read.data.ticket, actor)) notFound();

  // Opening the page is what clears this side's unread mark, exactly as
  // the API route does — the two doors into a thread must not disagree
  // about whether it has been seen.
  const ticket = await markRead(read.data.ticket, actor);

  return (
    <TicketThread
      initial={{
        staff: actor.staff,
        ticket,
        messages: visibleMessages(read.data.messages, actor),
        can: {
          reply: canReply(ticket, actor),
          note: canNote(ticket, actor),
          priority: canSetPriority(actor),
          statuses: allowedStatuses(ticket, actor),
        },
      }}
    />
  );
}
