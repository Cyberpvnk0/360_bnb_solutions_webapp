/**
 * What a support ticket is, and who may do what to it.
 *
 * Everything here is pure: no store, no session, no fetch. The rules
 * that decide whether a request is allowed live in one place so they
 * can be tested exhaustively and so a route never has to reason about
 * them inline — a route asks, and does what it is told.
 *
 * THE WORKFLOW, and why four states rather than two:
 *
 *   open      the member is waiting on us
 *   pending   we have answered; the member is the one holding the ball
 *   resolved  we believe it is done, but the thread is still live —
 *             a reply from the member reopens it
 *   closed    finished. Nobody writes to a closed ticket; either side
 *             may reopen it, which is a deliberate act rather than a
 *             side effect of typing.
 *
 * The distinction that earns its keep is open vs pending: a queue
 * sorted by "waiting on us" is the only view that tells the team what
 * is actually outstanding, and without it every answered-but-not-yet-
 * closed ticket sits in the list looking like work.
 */

export const TICKET_STATUSES = ["open", "pending", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_CATEGORIES = [
  "billing",
  "credits",
  "data",
  "bug",
  "account",
  "other",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const AUTHOR_ROLES = ["user", "staff", "system"] as const;
export type AuthorRole = (typeof AUTHOR_ROLES)[number];

/** What each status is called on the member's screen. */
export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  pending: "Awaiting your reply",
  resolved: "Resolved",
  closed: "Closed",
};

/** The same four, in the queue's language. */
export const STATUS_LABEL_STAFF: Record<TicketStatus, string> = {
  open: "Needs reply",
  pending: "Awaiting member",
  resolved: "Resolved",
  closed: "Closed",
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  billing: "Billing & plans",
  credits: "Credits & usage",
  data: "Market or property data",
  bug: "Something is broken",
  account: "Account & sign-in",
  other: "Something else",
};

/** Statuses that still want someone's attention. */
export const LIVE_STATUSES: readonly TicketStatus[] = ["open", "pending", "resolved"];

export const MAX_SUBJECT = 160;
export const MAX_BODY = 8_000;

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorId: string | null;
  authorRole: AuthorRole;
  authorName: string | null;
  body: string;
  internal: boolean;
  createdAt: string;
}

export interface Ticket {
  id: string;
  ref: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  messageCount: number;
  lastMessageAt: string;
  lastMessageRole: AuthorRole;
  unreadForUser: boolean;
  unreadForStaff: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

/** Who is asking. `staff` is decided by lib/auth/gate, never by a client. */
export interface Actor {
  userId: string;
  staff: boolean;
}

/* ------------------------------------------------------------------ */
/* Parsing what a client sent                                          */
/* ------------------------------------------------------------------ */

const inList = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;

export const asStatus = (v: unknown): TicketStatus | null => inList(TICKET_STATUSES, v);
export const asPriority = (v: unknown): TicketPriority | null =>
  inList(TICKET_PRIORITIES, v);
export const asCategory = (v: unknown): TicketCategory | null =>
  inList(TICKET_CATEGORIES, v);

/** Everything C0/C1 except the newline a message body is allowed to keep. */
const CONTROL = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g");

/**
 * A subject or a message body, trimmed and bounded — or null when what
 * arrived was not usable. Control characters go, because a body is
 * rendered as text and a subject is rendered in a list; newlines stay
 * in a body and never in a subject.
 */
export function cleanText(v: unknown, max: number, multiline = false): string | null {
  if (typeof v !== "string") return null;
  const stripped = multiline
    ? v.replace(/\r\n?/g, "\n").replace(/[^\S\n]+$/gm, "")
    : v.replace(/\s+/g, " ");
  const trimmed = stripped.replace(CONTROL, "").trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/* ------------------------------------------------------------------ */
/* References                                                          */
/* ------------------------------------------------------------------ */

/**
 * No 0/O, no 1/I/L. A ticket reference gets read off a screenshot and
 * typed back into a chat box, and every pair this alphabet leaves out
 * is a support conversation about the support conversation.
 */
export const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const REF_LENGTH = 6;

/** Six characters from the alphabet above. `random` is injectable so a
 *  test can pin the output; production hands it crypto randomness. */
export function makeRef(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < REF_LENGTH; i++) {
    const pick = Math.floor(random() * REF_ALPHABET.length);
    out += REF_ALPHABET[Math.min(Math.max(pick, 0), REF_ALPHABET.length - 1)];
  }
  return out;
}

/** True for something shaped like a reference we issued. */
export function isRef(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length === REF_LENGTH &&
    [...v].every((c) => REF_ALPHABET.includes(c))
  );
}

/* ------------------------------------------------------------------ */
/* Who may do what                                                     */
/* ------------------------------------------------------------------ */

/** Staff see every ticket. Everyone else sees the ones they raised. */
export function canRead(ticket: Pick<Ticket, "userId">, actor: Actor): boolean {
  return actor.staff || ticket.userId === actor.userId;
}

/**
 * Internal notes never leave the team.
 *
 * Called on the way out of every route that returns messages, so the
 * filter is not something an individual handler can forget. A member's
 * thread simply does not contain the notes — they are not hidden with
 * CSS, they are not in the payload.
 */
export function visibleMessages(
  messages: readonly TicketMessage[],
  actor: Actor
): TicketMessage[] {
  return actor.staff ? [...messages] : messages.filter((m) => !m.internal);
}

/**
 * May this actor add a message?
 *
 * A closed ticket takes no replies from either side — reopening is an
 * explicit act, so nobody types a paragraph into a thread nobody is
 * watching. Staff may always write to a live ticket; a member may
 * write to their own.
 */
export function canReply(
  ticket: Pick<Ticket, "userId" | "status">,
  actor: Actor
): boolean {
  if (ticket.status === "closed") return false;
  return canRead(ticket, actor);
}

/** Only staff write notes, and never on a closed ticket. */
export function canNote(
  ticket: Pick<Ticket, "userId" | "status">,
  actor: Actor
): boolean {
  return actor.staff && ticket.status !== "closed";
}

/** Priority is the team's judgement of the queue, not the member's. */
export function canSetPriority(actor: Actor): boolean {
  return actor.staff;
}

/**
 * The statuses this actor may move the ticket to from where it is.
 *
 * Staff drive the whole workflow. A member gets the two that are
 * honestly theirs: closing something they no longer need an answer to,
 * and reopening something they do. They cannot mark their own ticket
 * resolved — that is the team saying the work is done — and they
 * cannot set it to pending, which means "waiting on the member" and
 * would be a note to themselves.
 */
export function allowedStatuses(
  ticket: Pick<Ticket, "userId" | "status">,
  actor: Actor
): TicketStatus[] {
  if (!canRead(ticket, actor)) return [];
  if (actor.staff) return TICKET_STATUSES.filter((s) => s !== ticket.status);
  if (ticket.status === "closed") return ["open"];
  return ["closed"];
}

export function canSetStatus(
  ticket: Pick<Ticket, "userId" | "status">,
  actor: Actor,
  next: TicketStatus
): boolean {
  return allowedStatuses(ticket, actor).includes(next);
}

/* ------------------------------------------------------------------ */
/* What a message does to the ticket                                   */
/* ------------------------------------------------------------------ */

export interface TicketDelta {
  status: TicketStatus;
  unreadForUser: boolean;
  unreadForStaff: boolean;
  lastMessageRole: AuthorRole;
}

/**
 * The ticket's new state after someone writes to it.
 *
 * A member's reply puts the ticket back in the team's queue — including
 * from `resolved`, which is how "actually, that didn't fix it" works
 * without anyone having to find a button. A staff reply hands it back
 * to the member. An internal note moves nothing at all: it is the team
 * talking among themselves, and it must not make a member's screen
 * announce a reply that is not there.
 */
export function afterMessage(
  ticket: Pick<Ticket, "status" | "unreadForUser" | "unreadForStaff">,
  role: AuthorRole,
  internal = false
): TicketDelta {
  if (internal) {
    return {
      status: ticket.status,
      unreadForUser: ticket.unreadForUser,
      unreadForStaff: ticket.unreadForStaff,
      lastMessageRole: "staff",
    };
  }
  if (role === "user") {
    return {
      status: "open",
      unreadForUser: false,
      unreadForStaff: true,
      lastMessageRole: "user",
    };
  }
  if (role === "staff") {
    return {
      status: "pending",
      unreadForUser: true,
      unreadForStaff: false,
      lastMessageRole: "staff",
    };
  }
  return {
    status: ticket.status,
    unreadForUser: true,
    unreadForStaff: true,
    lastMessageRole: "system",
  };
}

/** How many of these want this actor's attention. */
export function unreadCount(tickets: readonly Ticket[], actor: Actor): number {
  return tickets.filter((t) => (actor.staff ? t.unreadForStaff : t.unreadForUser)).length;
}

/**
 * The queue order: what is waiting on us, longest-waiting first, then
 * everything else by most recent activity.
 *
 * Priority breaks ties WITHIN the waiting group rather than ordering
 * the whole list, so a low-priority ticket that has been sitting for a
 * week still outranks an urgent one answered ten minutes ago.
 */
const RANK: Record<TicketPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export function queueOrder(tickets: readonly Ticket[]): Ticket[] {
  const waiting = (t: Ticket) => t.status === "open";
  return [...tickets].sort((a, b) => {
    if (waiting(a) !== waiting(b)) return waiting(a) ? -1 : 1;
    if (waiting(a)) {
      if (RANK[a.priority] !== RANK[b.priority]) return RANK[a.priority] - RANK[b.priority];
      return a.lastMessageAt.localeCompare(b.lastMessageAt);
    }
    return b.lastMessageAt.localeCompare(a.lastMessageAt);
  });
}
