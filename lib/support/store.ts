/**
 * Tickets and their messages, read and written as the service.
 *
 * support_tickets and support_messages carry RLS with no policies (see
 * supabase/support-schema.sql), so nothing holding the browser key can
 * touch them. This module is the only door, and every function here is
 * reached from a route that has already decided who is asking. Nothing
 * below authorises anything — pass the wrong actor and it will happily
 * hand over someone else's thread. The rules live in ./ticket and the
 * routes apply them.
 *
 * FILTERS ARE BUILT, NEVER INTERPOLATED. PostgREST filters are a
 * grammar, and a search box that reaches it unescaped is an injection
 * into that grammar: a comma closes an `or(...)`, a dot starts a new
 * operator. `searchFilter` below reduces whatever arrived to characters
 * that cannot mean anything, which is cheaper than being clever and
 * leaves the search working for every term a person actually types.
 */

import { serviceRest } from "@/lib/db/service";
import {
  afterMessage,
  makeRef,
  type Actor,
  type AuthorRole,
  type Ticket,
  type TicketCategory,
  type TicketMessage,
  type TicketPriority,
  type TicketStatus,
} from "./ticket";

type Row = Record<string, unknown>;

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const bool = (v: unknown): boolean => v === true;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const TICKET_COLUMNS =
  "id,ref,user_id,user_email,user_name,subject,category,status,priority," +
  "message_count,last_message_at,last_message_role,unread_for_user,unread_for_staff," +
  "created_at,updated_at,closed_at";

const MESSAGE_COLUMNS =
  "id,ticket_id,author_id,author_role,author_name,body,internal,created_at";

function toTicket(row: Row): Ticket {
  return {
    id: str(row.id),
    ref: str(row.ref),
    userId: str(row.user_id),
    userEmail: strOrNull(row.user_email),
    userName: strOrNull(row.user_name),
    subject: str(row.subject),
    category: str(row.category, "other") as TicketCategory,
    status: str(row.status, "open") as TicketStatus,
    priority: str(row.priority, "normal") as TicketPriority,
    messageCount: num(row.message_count),
    lastMessageAt: str(row.last_message_at),
    lastMessageRole: str(row.last_message_role, "user") as AuthorRole,
    unreadForUser: bool(row.unread_for_user),
    unreadForStaff: bool(row.unread_for_staff),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    closedAt: strOrNull(row.closed_at),
  };
}

function toMessage(row: Row): TicketMessage {
  return {
    id: str(row.id),
    ticketId: str(row.ticket_id),
    authorId: strOrNull(row.author_id),
    authorRole: str(row.author_role, "user") as AuthorRole,
    authorName: strOrNull(row.author_name),
    body: str(row.body),
    internal: bool(row.internal),
    createdAt: str(row.created_at),
  };
}

export type StoreResult<T> = { ok: true; data: T } | { ok: false; detail: string };

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export interface ListQuery {
  /** Staff only: every ticket rather than the caller's own. */
  scope?: "mine" | "all";
  /** One status, or "live" for everything not closed. */
  status?: TicketStatus | "live" | "all";
  search?: string;
  limit?: number;
}

const MAX_LIST = 200;

/**
 * What a search term is allowed to be by the time it reaches the
 * filter: letters, digits, and the handful of punctuation an address
 * or a reference contains. Everything else — including every character
 * that means something in PostgREST's grammar — is dropped rather than
 * escaped, because there is no term worth the risk of getting the
 * escaping subtly wrong.
 */
export function searchFilter(raw: string): string | null {
  const safe = raw.replace(/[^A-Za-z0-9 @._-]/g, " ").trim().slice(0, 60);
  if (safe.length < 2) return null;
  const term = `*${safe.replace(/\s+/g, "*")}*`;
  return `or=(subject.ilike.${term},ref.ilike.${term},user_email.ilike.${term},user_name.ilike.${term})`;
}

export async function listTickets(
  actor: Actor,
  query: ListQuery = {}
): Promise<StoreResult<Ticket[]>> {
  const parts = [`select=${TICKET_COLUMNS}`];

  // The scope is the whole security boundary of this function: a
  // non-staff caller is pinned to their own rows here and cannot widen
  // it with a query string, because `scope` is only consulted when the
  // actor is staff.
  if (!(actor.staff && query.scope === "all")) {
    parts.push(`user_id=eq.${encodeURIComponent(actor.userId)}`);
  }

  if (query.status === "live") parts.push("status=in.(open,pending,resolved)");
  else if (query.status && query.status !== "all") parts.push(`status=eq.${query.status}`);

  if (query.search) {
    const filter = searchFilter(query.search);
    if (filter) parts.push(filter);
  }

  parts.push("order=last_message_at.desc");
  parts.push(`limit=${Math.min(Math.max(query.limit ?? MAX_LIST, 1), MAX_LIST)}`);

  const res = await serviceRest<Row[]>(`support_tickets?${parts.join("&")}`);
  if (!res.ok) return res;
  return { ok: true, data: (res.data ?? []).map(toTicket) };
}

/**
 * How many threads are waiting on this side — ids only.
 *
 * Its own query rather than a count over listTickets, because the badge
 * is fetched on every page in the shell and the list is not: asking for
 * subjects, categories and timestamps to render a number would make the
 * cheapest thing on the screen the most expensive request behind it.
 * Bounded, so a neglected queue costs the same as a tidy one.
 */
export async function countUnread(actor: Actor): Promise<number> {
  const flag = actor.staff ? "unread_for_staff" : "unread_for_user";
  const parts = ["select=id", `${flag}=is.true`, "limit=99"];
  // Staff are counting the queue; everyone else is counting their own.
  if (!actor.staff) parts.push(`user_id=eq.${encodeURIComponent(actor.userId)}`);
  else parts.push("status=in.(open,pending,resolved)");
  const res = await serviceRest<Row[]>(`support_tickets?${parts.join("&")}`);
  return res.ok ? (res.data ?? []).length : 0;
}

/** One ticket and its whole thread, internal notes included. The caller
 *  decides who may see it and strips notes with visibleMessages. */
export async function readTicket(
  id: string
): Promise<StoreResult<{ ticket: Ticket; messages: TicketMessage[] } | null>> {
  const key = encodeURIComponent(id);
  const [tRes, mRes] = await Promise.all([
    serviceRest<Row[]>(`support_tickets?id=eq.${key}&select=${TICKET_COLUMNS}&limit=1`),
    serviceRest<Row[]>(
      `support_messages?ticket_id=eq.${key}&select=${MESSAGE_COLUMNS}&order=created_at.asc&limit=500`
    ),
  ]);
  if (!tRes.ok) return tRes;
  const row = (tRes.data ?? [])[0];
  if (!row) return { ok: true, data: null };
  if (!mRes.ok) return mRes;
  return {
    ok: true,
    data: { ticket: toTicket(row), messages: (mRes.data ?? []).map(toMessage) },
  };
}

/**
 * The member's display name, for the copy that lands on the ticket.
 *
 * From profiles rather than from the session's user metadata, because
 * the metadata is only what was typed at signup and /api/profile writes
 * the column — a member who has since renamed themselves should appear
 * in the queue under the name they chose. Never fails a ticket: an
 * unreachable profile is a ticket with no name on it, not no ticket.
 */
export async function readMemberName(userId: string): Promise<string | null> {
  const res = await serviceRest<Row[]>(
    `profiles?id=eq.${encodeURIComponent(userId)}&select=full_name&limit=1`
  );
  if (!res.ok) return null;
  return strOrNull((res.data ?? [])[0]?.full_name);
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

const REF_ATTEMPTS = 5;

export interface NewTicket {
  userId: string;
  userEmail: string | null;
  userName: string | null;
  subject: string;
  category: TicketCategory;
  body: string;
}

/**
 * A ticket and its opening message.
 *
 * The reference is generated here and retried on collision: the column
 * is unique, so a clash is a failed insert rather than a duplicate, and
 * five attempts against a billion-value space is not a real loop. If
 * the message insert fails after the ticket row landed, the ticket is
 * removed again — a ticket with no message is a row nobody can answer
 * and a thread that renders as blank.
 */
export async function createTicket(input: NewTicket): Promise<StoreResult<Ticket>> {
  const now = new Date().toISOString();
  let lastDetail = "could not allocate a reference";

  for (let attempt = 0; attempt < REF_ATTEMPTS; attempt++) {
    const res = await serviceRest<Row[]>("support_tickets", {
      method: "POST",
      prefer: "return=representation",
      body: {
        ref: makeRef(),
        user_id: input.userId,
        user_email: input.userEmail,
        user_name: input.userName,
        subject: input.subject,
        category: input.category,
        status: "open",
        priority: "normal",
        message_count: 1,
        last_message_at: now,
        last_message_role: "user",
        unread_for_user: false,
        unread_for_staff: true,
        created_at: now,
        updated_at: now,
      },
    });

    if (!res.ok) {
      lastDetail = res.detail;
      // 23505 is the unique violation; anything else will not improve
      // by trying again with a different six characters.
      if (!/23505|duplicate key/i.test(res.detail)) return { ok: false, detail: res.detail };
      continue;
    }

    const row = (res.data ?? [])[0];
    if (!row) return { ok: false, detail: "ticket insert returned nothing" };
    const ticket = toTicket(row);

    const first = await serviceRest<Row[]>("support_messages", {
      method: "POST",
      prefer: "return=representation",
      body: {
        ticket_id: ticket.id,
        author_id: input.userId,
        author_role: "user",
        author_name: input.userName,
        body: input.body,
        internal: false,
        created_at: now,
      },
    });
    if (!first.ok) {
      await serviceRest(`support_tickets?id=eq.${encodeURIComponent(ticket.id)}`, {
        method: "DELETE",
      });
      return { ok: false, detail: first.detail };
    }
    return { ok: true, data: ticket };
  }

  return { ok: false, detail: lastDetail };
}

export interface NewMessage {
  authorId: string;
  authorRole: AuthorRole;
  authorName: string | null;
  body: string;
  internal: boolean;
}

/**
 * A reply, and the ticket state it implies.
 *
 * The message lands first and the ticket is updated after, so a
 * failure between the two leaves a thread that is complete and a
 * counter that is stale — recoverable, and visible. The other order
 * loses the message.
 */
export async function addMessage(
  ticket: Ticket,
  input: NewMessage
): Promise<StoreResult<{ message: TicketMessage; ticket: Ticket }>> {
  const now = new Date().toISOString();
  const res = await serviceRest<Row[]>("support_messages", {
    method: "POST",
    prefer: "return=representation",
    body: {
      ticket_id: ticket.id,
      author_id: input.authorId,
      author_role: input.authorRole,
      author_name: input.authorName,
      body: input.body,
      internal: input.internal,
      created_at: now,
    },
  });
  if (!res.ok) return res;
  const row = (res.data ?? [])[0];
  if (!row) return { ok: false, detail: "message insert returned nothing" };

  const delta = afterMessage(ticket, input.authorRole, input.internal);
  const patch = await patchTicket(ticket.id, {
    status: delta.status,
    unreadForUser: delta.unreadForUser,
    unreadForStaff: delta.unreadForStaff,
    lastMessageRole: delta.lastMessageRole,
    lastMessageAt: now,
    messageCount: ticket.messageCount + 1,
    // Reopening by reply has to clear the closing date with it, or a
    // live ticket carries a "closed on" that is no longer true.
    closedAt: delta.status === "closed" ? ticket.closedAt : null,
  });
  if (!patch.ok) return patch;

  return { ok: true, data: { message: toMessage(row), ticket: patch.data } };
}

export interface TicketPatch {
  status?: TicketStatus;
  priority?: TicketPriority;
  unreadForUser?: boolean;
  unreadForStaff?: boolean;
  lastMessageRole?: AuthorRole;
  lastMessageAt?: string;
  messageCount?: number;
  closedAt?: string | null;
}

export async function patchTicket(
  id: string,
  patch: TicketPatch
): Promise<StoreResult<Ticket>> {
  const body: Row = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) {
    body.status = patch.status;
    // Whoever sets the status owns the closing date, unless the caller
    // has already said what it should be.
    if (patch.closedAt === undefined) {
      body.closed_at = patch.status === "closed" ? new Date().toISOString() : null;
    }
  }
  if (patch.closedAt !== undefined) body.closed_at = patch.closedAt;
  if (patch.priority !== undefined) body.priority = patch.priority;
  if (patch.unreadForUser !== undefined) body.unread_for_user = patch.unreadForUser;
  if (patch.unreadForStaff !== undefined) body.unread_for_staff = patch.unreadForStaff;
  if (patch.lastMessageRole !== undefined) body.last_message_role = patch.lastMessageRole;
  if (patch.lastMessageAt !== undefined) body.last_message_at = patch.lastMessageAt;
  if (patch.messageCount !== undefined) body.message_count = patch.messageCount;

  const res = await serviceRest<Row[]>(
    `support_tickets?id=eq.${encodeURIComponent(id)}&select=${TICKET_COLUMNS}`,
    { method: "PATCH", prefer: "return=representation", body }
  );
  if (!res.ok) return res;
  const row = (res.data ?? [])[0];
  if (!row) return { ok: false, detail: "no such ticket" };
  return { ok: true, data: toTicket(row) };
}

/**
 * This side has now seen the thread.
 *
 * Best effort on purpose: failing to clear a dot must never fail the
 * read that was the point of the request. The caller gets the ticket
 * either way, already reflecting the clear so the badge does not
 * linger on screen until the next load.
 */
export async function markRead(ticket: Ticket, actor: Actor): Promise<Ticket> {
  const alreadyRead = actor.staff ? !ticket.unreadForStaff : !ticket.unreadForUser;
  if (alreadyRead) return ticket;
  const patch = actor.staff ? { unreadForStaff: false } : { unreadForUser: false };
  const res = await patchTicket(ticket.id, patch);
  return res.ok ? res.data : { ...ticket, ...(actor.staff
    ? { unreadForStaff: false }
    : { unreadForUser: false }) };
}
