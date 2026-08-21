"use client";

/**
 * Comp revenue range: where this property's projection lands among the
 * annual revenues of the comps behind it. Pure SVG — thin gold bars,
 * tabular axis labels, the subject's bin in full gold with a marker.
 */

import { annualRevenueFromAdr } from "@/lib/calc/arbitrage";
import { compSetStrength, type StrCompLike } from "@/lib/calc/comps";
import { fmtMoneyShort } from "@/lib/format";
import { MetricLabel } from "@/components/primitives/metric-label";
import type { StrComp } from "@/lib/mock/types";
import { cn } from "@/lib/utils";

const BIN_COUNT = 9;
const W = 1080;
const H = 64;
const BAR_GAP = 8;

export function RevenueRange({
  comps,
  subjectAnnualRevenue,
  className,
}: {
  comps: StrComp[];
  subjectAnnualRevenue: number;
  className?: string;
}) {
  const revenues = comps.map((c) => annualRevenueFromAdr(c.adr, c.occupancy));
  if (revenues.length === 0) return null;

  const lo = Math.min(...revenues, subjectAnnualRevenue);
  const hi = Math.max(...revenues, subjectAnnualRevenue);
  const pad = (hi - lo) * 0.06 || hi * 0.05 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const span = max - min;

  const bins = Array.from({ length: BIN_COUNT }, () => 0);
  for (const r of revenues) {
    const i = Math.min(BIN_COUNT - 1, Math.floor(((r - min) / span) * BIN_COUNT));
    bins[i] += 1;
  }
  const maxCount = Math.max(...bins, 1);
  const subjectBin = Math.min(
    BIN_COUNT - 1,
    Math.max(0, Math.floor(((subjectAnnualRevenue - min) / span) * BIN_COUNT))
  );
  // Fixed precision so server and client serialize identically.
  const subjectX = Math.round(((subjectAnnualRevenue - min) / span) * W * 100) / 100;

  const barW = (W - BAR_GAP * (BIN_COUNT - 1)) / BIN_COUNT;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-4">
        <MetricLabel>Comp revenue range</MetricLabel>
        <StrengthMeter comps={comps} />
      </div>
      <svg
        viewBox={`0 0 ${W} ${H + 16}`}
        className="mt-2 block w-full"
        role="img"
        aria-label={`This property's projected annual revenue of ${fmtMoneyShort(subjectAnnualRevenue)} shown against ${comps.length} comps ranging ${fmtMoneyShort(Math.min(...revenues))} to ${fmtMoneyShort(Math.max(...revenues))}`}
      >
        {/* Baseline */}
        <line x1="0" y1={H} x2={W} y2={H} stroke="var(--border)" strokeWidth="1" />
        {bins.map((count, i) => {
          const bh = count === 0 ? 2 : 6 + (count / maxCount) * (H - 12);
          const x = i * (barW + BAR_GAP);
          const isSubject = i === subjectBin;
          return (
            <rect
              key={i}
              x={x}
              y={H - bh}
              width={barW}
              height={bh}
              rx="1.5"
              fill="var(--gold-fill)"
              fillOpacity={count === 0 ? 0.1 : isSubject ? 0.85 : 0.25}
            />
          );
        })}
        {/* Subject marker */}
        <line
          x1={subjectX}
          y1={2}
          x2={subjectX}
          y2={H}
          stroke="var(--text)"
          strokeWidth="1.25"
          strokeDasharray="3 2.5"
        />
        {/* Axis labels */}
        <text x="0" y={H + 13} fill="var(--text-muted)" fontSize="10" className="tabular">
          {fmtMoneyShort(min + pad)}
        </text>
        <text
          x={W / 2}
          y={H + 13}
          fill="var(--text-muted)"
          fontSize="10"
          textAnchor="middle"
          className="tabular"
        >
          {fmtMoneyShort(min + span / 2)}
        </text>
        <text
          x={W}
          y={H + 13}
          fill="var(--text-muted)"
          fontSize="10"
          textAnchor="end"
          className="tabular"
        >
          {fmtMoneyShort(max - pad)}
        </text>
      </svg>
      <p className="mt-1 text-[11px] text-muted-foreground">
        The dashed line is this property&apos;s projection among its {comps.length}{" "}
        comps.
      </p>
    </div>
  );
}

/** Five-segment confidence meter for the comp set. Gold, never a grade. */
export function StrengthMeter({
  comps,
  className,
}: {
  comps: StrCompLike[];
  className?: string;
}) {
  const { score, label } = compSetStrength(comps);
  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      aria-label={`Comp set strength ${label}, ${score} of 5`}
    >
      <span className="text-[11px] text-muted-foreground">
        Comp strength{" "}
        <span className="font-medium text-foreground">{label}</span>
      </span>
      <span aria-hidden className="flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 w-3 rounded-xs",
              i < score ? "bg-gold-fill" : "border border-border bg-transparent"
            )}
          />
        ))}
      </span>
    </span>
  );
}
