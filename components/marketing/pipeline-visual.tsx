import { MetricLabel } from "@/components/primitives/metric-label";
import { StatusChip } from "@/components/primitives/status-chip";

const STAGES = [
  { label: "Prospecting", count: 4, tone: "neutral" as const },
  { label: "LOI Sent", count: 2, tone: "outline" as const },
  { label: "Live", count: 1, tone: "gold" as const },
];

/**
 * Pipeline mock: three stage chips with deal counts, and the private
 * landlord book strip beneath.
 */
export function PipelineVisual({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="overflow-hidden rounded-sm border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <MetricLabel>Pipeline</MetricLabel>
          <MetricLabel>Private to you</MetricLabel>
        </div>
        <div className="grid grid-cols-3 divide-x divide-border">
          {STAGES.map((s) => (
            <div key={s.label} className="px-4 py-5">
              <StatusChip tone={s.tone}>{s.label}</StatusChip>
              <div className="mt-3 text-2xl font-semibold leading-none tracking-tight text-foreground tabular">
                {s.count}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {s.count === 1 ? "deal" : "deals"}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <MetricLabel>Landlord book</MetricLabel>
          <span className="text-xs text-muted-foreground tabular">
            12 contacts — visible only to you
          </span>
        </div>
      </div>
    </div>
  );
}
