import Link from "next/link";
import {
  Contact,
  Crosshair,
  Eye,
  FileDown,
  FolderPlus,
  MoveRight,
  type LucideIcon,
} from "lucide-react";
import type { ActivityEvent, ActivityType } from "@/lib/mock/types";
import { fmtDate } from "@/lib/format";
import { EmptyState } from "@/components/primitives/empty-state";

const TYPE_ICON: Record<ActivityType, LucideIcon> = {
  pull: Crosshair,
  "deal-saved": FolderPlus,
  "deal-stage": MoveRight,
  "landlord-added": Contact,
  "market-watched": Eye,
  export: FileDown,
};

function RowContent({ event }: { event: ActivityEvent }) {
  const Icon = TYPE_ICON[event.type];
  return (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-secondary">
        <Icon
          aria-hidden
          className="size-3.5 text-muted-foreground"
          strokeWidth={1.75}
        />
      </span>
      <span className="min-w-0 flex-1 text-sm leading-snug text-foreground">
        {event.message}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground tabular">
        {fmtDate(event.at.slice(0, 10))}
      </span>
    </>
  );
}

/**
 * Recent-activity module: the last 30 days of pulls, saves, stage moves
 * and exports, in a card with feed rows flush to its edges.
 */
export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  const shown = events.slice(0, 8);

  return (
    <section
      aria-labelledby="activity-title"
      className="overflow-hidden rounded-sm border border-border bg-card"
    >
      <div className="border-b border-border px-6 py-4">
        <h2 id="activity-title" className="text-sm font-semibold text-foreground">
          Recent activity
        </h2>
      </div>

      {shown.length === 0 ? (
        <div className="p-6">
          <EmptyState
            icon={Crosshair}
            title="No activity yet"
            description="Pulls, saved deals and stage moves will land here."
          />
        </div>
      ) : (
        <>
          <div className="divide-y divide-border">
            {shown.map((event) =>
              event.href ? (
                <Link
                  key={event.id}
                  href={event.href}
                  className="flex items-center gap-3 px-6 py-3.5 transition-colors duration-150 hover:bg-secondary/40"
                >
                  <RowContent event={event} />
                </Link>
              ) : (
                <div key={event.id} className="flex items-center gap-3 px-6 py-3.5">
                  <RowContent event={event} />
                </div>
              )
            )}
          </div>
          <p className="border-t border-border px-6 py-3.5 text-xs text-muted-foreground">
            That&apos;s the last 30 days.
          </p>
        </>
      )}
    </section>
  );
}
