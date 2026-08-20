import { APP_DOMAIN } from "@/config/app";
import { BreakevenGauge } from "@/components/primitives/breakeven-gauge";
import { MetricLabel } from "@/components/primitives/metric-label";

/**
 * The hero's live product mockup: a hairline-framed faux browser window
 * holding a real BreakevenGauge and three mini output tiles — a miniature
 * of the analyze screen. All figures are internally consistent:
 * 63% market − 46% breakeven = 17 pts; $12,500 furnishing / $1,264 ≈ 9.9 mo.
 */
export function HeroMockup({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="overflow-hidden rounded-sm border border-border bg-card">
        {/* Titlebar */}
        <div className="flex h-8 items-center gap-3 border-b border-border px-3">
          <svg width="34" height="8" viewBox="0 0 34 8" aria-hidden className="shrink-0">
            <circle cx="4" cy="4" r="3" fill="none" stroke="var(--border)" />
            <circle cx="17" cy="4" r="3" fill="none" stroke="var(--border)" />
            <circle cx="30" cy="4" r="3" fill="none" stroke="var(--border)" />
          </svg>
          <span className="min-w-0 flex-1 truncate text-center text-[11px] text-muted-foreground tabular">
            {APP_DOMAIN}/analyze
          </span>
          <span aria-hidden className="w-[34px] shrink-0" />
        </div>

        {/* Gauge */}
        <div className="flex flex-col items-center px-6 pb-7 pt-8">
          <BreakevenGauge breakeven={0.46} marketOccupancy={0.63} size={200} strokeWidth={5}>
            <MetricLabel className="text-[9px] leading-3">Breakeven</MetricLabel>
            <div className="mt-0.5 font-display text-5xl font-medium leading-none tracking-tight text-foreground tabular">
              46%
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              market runs at{" "}
              <span className="font-medium text-foreground tabular">63%</span>
            </p>
          </BreakevenGauge>
        </div>

        {/* Mini output tiles */}
        <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
          <div className="px-4 py-3">
            <MetricLabel className="text-[9px] leading-3">Net cash flow</MetricLabel>
            <div className="mt-1 text-base font-semibold leading-tight tracking-tight text-gold tabular">
              $1,264
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">per month</div>
          </div>
          <div className="px-4 py-3">
            <MetricLabel className="text-[9px] leading-3">Margin of safety</MetricLabel>
            <div className="mt-1 text-base font-semibold leading-tight tracking-tight text-foreground tabular">
              17 pts
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">63 − 46</div>
          </div>
          <div className="px-4 py-3">
            <MetricLabel className="text-[9px] leading-3">Payback</MetricLabel>
            <div className="mt-1 text-base font-semibold leading-tight tracking-tight text-foreground tabular">
              9.9 mo
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">on $12,500 in</div>
          </div>
        </div>
      </div>
    </div>
  );
}
