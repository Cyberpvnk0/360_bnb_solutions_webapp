"use client";

/**
 * /support/[id] — one conversation.
 *
 * A vertical log rather than chat bubbles. A support thread is a record
 * that gets read back weeks later, often by someone who was not in it,
 * and alternating bubbles optimise for the wrong thing: who is speaking
 * matters less than what was said and when. Each message is a block
 * with an author line above it, in order, and the team's replies carry
 * a gold rule so a member can see at a glance which of these came from
 * us.
 *
 * INTERNAL NOTES ARE NEVER IN THE PAYLOAD. The API strips them for
 * anyone who is not staff, so this component's `internal` styling is a
 * label for the team, not a privacy mechanism. Nothing here hides
 * anything: it cannot, because it was never sent.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Lock, Send, ShieldCheck, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CATEGORY_LABEL,
  MAX_BODY,
  PRIORITY_LABEL,
  STATUS_LABEL,
  STATUS_LABEL_STAFF,
  TICKET_PRIORITIES,
  type Ticket,
  type TicketMessage,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/support/ticket";
import { refreshUnread } from "@/lib/support/unread";
import { fullWhen, timeAgo } from "@/lib/support/when";
import { TicketStatusChip } from "./chips";

export interface ThreadPermissions {
  reply: boolean;
  note: boolean;
  priority: boolean;
  statuses: TicketStatus[];
}

export interface ThreadData {
  staff: boolean;
  ticket: Ticket;
  messages: TicketMessage[];
  can: ThreadPermissions;
}

function Message({ message }: { message: TicketMessage }) {
  const fromStaff = message.authorRole === "staff";
  const system = message.authorRole === "system";
  const who = system
    ? "System"
    : fromStaff
      ? (message.authorName ?? "Support")
      : (message.authorName ?? "You");

  if (system) {
    return (
      <li className="py-2 text-center text-xs text-muted-foreground">
        {message.body}
        <span aria-hidden> · </span>
        <time dateTime={message.createdAt} title={fullWhen(message.createdAt)}>
          {timeAgo(message.createdAt)}
        </time>
      </li>
    );
  }

  return (
    <li
      className={cn(
        "rounded-sm border bg-card px-4 py-3.5",
        message.internal
          ? "border-dashed border-gold-fill/50 bg-[color-mix(in_oklab,var(--color-gold-fill)_7%,var(--color-card))]"
          : "border-border",
        fromStaff && !message.internal && "border-l-2 border-l-gold-fill"
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex size-5 items-center justify-center rounded-full border border-border bg-secondary">
          {fromStaff ? (
            <ShieldCheck aria-hidden className="size-3 text-gold" />
          ) : (
            <User aria-hidden className="size-3 text-muted-foreground" />
          )}
        </span>
        <span className="text-sm font-medium text-foreground">{who}</span>
        {fromStaff && !message.internal ? (
          <span className="text-xs text-muted-foreground">Support team</span>
        ) : null}
        {message.internal ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-gold-fill/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-gold">
            <Lock aria-hidden className="size-2.5" />
            Internal — not sent to the member
          </span>
        ) : null}
        <time
          dateTime={message.createdAt}
          title={fullWhen(message.createdAt)}
          className="ml-auto text-xs text-muted-foreground tabular"
        >
          {timeAgo(message.createdAt)}
        </time>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
        {message.body}
      </p>
    </li>
  );
}

export function TicketThread({ initial }: { initial: ThreadData }) {
  const router = useRouter();
  const [ticket, setTicket] = React.useState(initial.ticket);
  const [messages, setMessages] = React.useState(initial.messages);
  const [can, setCan] = React.useState(initial.can);
  const [draft, setDraft] = React.useState("");
  const [internal, setInternal] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const staff = initial.staff;

  const endRef = React.useRef<HTMLDivElement | null>(null);

  // The server cleared this side's mark while rendering the page, so
  // the badge in the sidebar is now one ahead of the truth. Asking once
  // on arrival is cheaper than threading the old value through just to
  // decrement it, and it is right even when the thread was already read.
  React.useEffect(() => {
    void refreshUnread();
  }, []);

  const canSend = draft.trim().length > 0 && !sending && (internal ? can.note : can.reply);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setSending(true);
    try {
      const res = await fetch(`/api/support/tickets/${ticket.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: draft, internal }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: TicketMessage;
        ticket?: Ticket;
      } | null;
      if (!res.ok || !data?.ok || !data.message || !data.ticket) {
        toast.error("That didn't send", { description: "Nothing was lost — try again." });
        return;
      }
      setMessages((prev) => [...prev, data.message!]);
      setTicket(data.ticket);
      setDraft("");
      void refreshUnread();
      // The reply changed the ticket's state, so what may be done to it
      // next changed with it — a member replying to a resolved ticket
      // reopened it, and can now close it again.
      router.refresh();
      requestAnimationFrame(() =>
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
      );
    } finally {
      setSending(false);
    }
  };

  const patch = async (body: Record<string, string>, label: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/support/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        ticket?: Ticket;
        can?: ThreadPermissions;
      } | null;
      if (!res.ok || !data?.ok || !data.ticket) {
        toast.error("That didn't save");
        return;
      }
      setTicket(data.ticket);
      if (data.can) setCan(data.can);
      void refreshUnread();
      toast.success(label);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = staff ? STATUS_LABEL_STAFF : STATUS_LABEL;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-10">
      <Link
        href={staff ? "/support?scope=all" : "/support"}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        {staff ? "Back to the queue" : "Back to your tickets"}
      </Link>

      <header className="mt-4 border-b border-border pb-5">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {ticket.subject}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-muted-foreground">
          <span className="tabular font-medium text-foreground">{ticket.ref}</span>
          <span aria-hidden>·</span>
          <span>{CATEGORY_LABEL[ticket.category]}</span>
          <span aria-hidden>·</span>
          <span title={fullWhen(ticket.createdAt)}>Opened {timeAgo(ticket.createdAt)}</span>
          {staff && (ticket.userName || ticket.userEmail) ? (
            <>
              <span aria-hidden>·</span>
              <span className="text-foreground">{ticket.userName || ticket.userEmail}</span>
              {ticket.userName && ticket.userEmail ? (
                <span className="text-muted-foreground">{ticket.userEmail}</span>
              ) : null}
            </>
          ) : null}
          {/* Status only. The priority select below says the same thing
              and can change it; two readouts a centimetre apart is one
              too many. */}
          <span className="ml-auto flex items-center gap-1.5">
            <TicketStatusChip status={ticket.status} staff={staff} />
          </span>
        </div>
      </header>

      {can.statuses.length > 0 || can.priority ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {can.priority ? (
            <Select
              value={ticket.priority}
              onValueChange={(v) =>
                patch({ priority: v }, `Priority set to ${PRIORITY_LABEL[v as TicketPriority]}`)
              }
            >
              <SelectTrigger size="sm" aria-label="Priority" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TICKET_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {can.statuses.map((s) => (
            <Button
              key={s}
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => patch({ status: s }, `Marked ${statusLabel[s].toLowerCase()}`)}
            >
              {s === "open" && ticket.status === "closed"
                ? "Reopen"
                : `Mark ${statusLabel[s].toLowerCase()}`}
            </Button>
          ))}
        </div>
      ) : null}

      <ol className="mt-6 space-y-3">
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
      </ol>
      <div ref={endRef} />

      {can.reply || can.note ? (
        <form onSubmit={send} className="mt-6 rounded-sm border border-border bg-card p-4">
          <Label htmlFor="reply" className="text-sm">
            {staff ? "Reply to the member" : "Add to this ticket"}
          </Label>
          <Textarea
            id="reply"
            value={draft}
            maxLength={MAX_BODY}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              internal ? "A note only the team can read" : "Type your reply"
            }
            className="mt-2 min-h-28"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            {can.note ? (
              <div className="flex items-center gap-2">
                <Switch
                  id="internal"
                  checked={internal}
                  onCheckedChange={setInternal}
                  aria-label="Internal note"
                />
                <Label htmlFor="internal" className="text-sm text-muted-foreground">
                  Internal note — the member will not see this
                </Label>
              </div>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={!canSend}>
              {sending ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  Sending
                </>
              ) : (
                <>
                  <Send aria-hidden className="size-4" />
                  {internal ? "Save note" : "Send reply"}
                </>
              )}
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-6 rounded-sm border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
          This ticket is closed. Reopen it above if you need to add anything.
        </p>
      )}
    </div>
  );
}
