import { MetricLabel } from "@/components/primitives/metric-label";

const COMPS = [
  { name: "2 bd · 0.2 mi", adr: "$211", occ: "61%", rev: "$47.0k" },
  { name: "2 bd · 0.3 mi", adr: "$224", occ: "66%", rev: "$54.0k" },
  { name: "3 bd · 0.4 mi", adr: "$237", occ: "62%", rev: "$53.6k" },
];

/**
 * Mini comps-table mock: three muted rows and the gold market-average
 * line they produce. Averages are the real averages of the rows.
 */
export function CompsVisual({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="overflow-hidden rounded-sm border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <MetricLabel>Nightly comps</MetricLabel>
          <MetricLabel>Within 0.4 mi</MetricLabel>
        </div>
        <div className="px-4 py-1 text-xs tabular">
          <div className="grid grid-cols-[minmax(0,1.6fr)_1fr_1fr_1fr] gap-2 border-b border-border py-2">
            <MetricLabel className="text-[9px] leading-3">Comp</MetricLabel>
            <MetricLabel className="text-right text-[9px] leading-3">ADR</MetricLabel>
            <MetricLabel className="text-right text-[9px] leading-3">Occupancy</MetricLabel>
            <MetricLabel className="text-right text-[9px] leading-3">Rev / yr</MetricLabel>
          </div>
          {COMPS.map((c) => (
            <div
              key={c.name}
              className="grid grid-cols-[minmax(0,1.6fr)_1fr_1fr_1fr] gap-2 py-2.5 text-muted-foreground"
            >
              <span className="truncate">{c.name}</span>
              <span className="text-right">{c.adr}</span>
              <span className="text-right">{c.occ}</span>
              <span className="text-right">{c.rev}</span>
            </div>
          ))}
          <div className="grid grid-cols-[minmax(0,1.6fr)_1fr_1fr_1fr] gap-2 border-t border-border py-2.5 font-medium text-gold">
            <span className="truncate">Market average</span>
            <span className="text-right">$224</span>
            <span className="text-right">63%</span>
            <span className="text-right">$51.5k</span>
          </div>
        </div>
      </div>
    </div>
  );
}
