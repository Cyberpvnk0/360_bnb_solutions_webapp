import { StatusChip } from "@/components/primitives/status-chip";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  STATUS_LABEL_STAFF,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/support/ticket";

/**
 * A ticket's state, in the colour the reader's own position makes true.
 *
 * "Open" is gold to the team — it is the work — and neutral to the
 * member, for whom an open ticket is simply the normal state of having
 * asked something. "Awaiting your reply" is the reverse: the one that
 * wants the member's attention. Neither side is ever shown red: a
 * support ticket is not an error, and the red chip in this system
 * carries a warning icon that would be a lie here.
 */
export function TicketStatusChip({
  status,
  staff = false,
}: {
  status: TicketStatus;
  staff?: boolean;
}) {
  const wantsYou = staff ? status === "open" : status === "pending";
  const tone = status === "closed" ? "neutral" : wantsYou ? "gold" : "outline";
  return (
    <StatusChip tone={tone}>
      {staff ? STATUS_LABEL_STAFF[status] : STATUS_LABEL[status]}
    </StatusChip>
  );
}

/** Priority, shown only where it means something — the staff queue.
 *  Normal is not drawn at all: a chip on every row is not a signal. */
export function TicketPriorityChip({ priority }: { priority: TicketPriority }) {
  if (priority === "normal") return null;
  return (
    <StatusChip tone={priority === "urgent" || priority === "high" ? "gold" : "neutral"}>
      {PRIORITY_LABEL[priority]}
    </StatusChip>
  );
}

/** The dot that says "there is something here you have not read". */
export function UnreadDot({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      aria-label="Unread"
      className="inline-block size-1.5 shrink-0 rounded-full bg-gold"
    />
  );
}
