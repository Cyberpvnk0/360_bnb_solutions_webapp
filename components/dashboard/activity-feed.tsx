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
import { MetricLabel } from "@/components/primitives/metric-label";

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

/** The last 30 days of pulls, saves, stage moves and exports. */
export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  const shown = events.slice(0, 8);

  return (
    <section aria-labelledby="activity-title">
      <MetricLabel id="activity-title">Recent activity</MetricLabel>

      {shown.length === 0 ? (
        <EmptyState
          className="mt-3"
          icon={Crosshair}
          title="No activity yet"
          description="Pulls, saved deals and stage moves will land here."
        />
      ) : (
        <>
          <div className="mt-3 divide-y divide-border border-y border-border">
            {shown.map((event) =>
              event.href ? (
                <Link
                  key={event.id}
                  href={event.href}
                  className="flex items-center gap-3 px-3 py-3.5 transition-colors duration-150 hover:bg-secondary/40"
                >
                  <RowContent event={event} />
                </Link>
              ) : (
                <div key={event.id} className="flex items-center gap-3 px-3 py-3.5">
                  <RowContent event={event} />
                </div>
              )
            )}
          </div>
          <p className="mt-3 px-3 text-xs text-muted-foreground">
            That&apos;s the last 30 days.
          </p>
        </>
      )}
    </section>
  );
}
