"use client";

/**
 * Where this property sits among its comps — readable in one look.
 *
 * The histogram this replaces asked a reader to decode bins, a shaded
 * quartile band and a dashed line before it said anything. This says
 * the one thing first, in words: your projection is higher than N of
 * the M comps. Underneath, a single strip carries the evidence — every
 * comp as a dot along a money axis, the middle half shaded, the median
 * ticked, and your figure planted on it with its label — so the
 * sentence can be checked in a glance rather than believed.
 *
 * ONE AXIS, ONE MEASURE: annual revenue, in dollars, left to right.
 * Measured earnings when the feed supplies them for every comp,
 * modelled (rate × occupancy × 365) otherwise, never a blend — the
 * caption says which.
 */

import * as React from "react";
import {
  compSetStrength,
  revenueBasis,
  revenueQuartiles,
  type StrCompLike,
} from "@/lib/calc/comps";
import { fmtMoney, fmtMoneyShort, fmtPct } from "@/lib/format";
import { MetricLabel } from "@/components/primitives/metric-label";
import type { StrComp } from "@/lib/mock/types";
import { HINTS } from "@/lib/copy/hints";
import { cn } from "@/lib/utils";

/** Dot diameter in percent of the track, used to stack colliding dots. */
const DOT_GAP_PCT = 1.6;
const LANES = 3;

/** Lay comps out along the track, stacking into a second and third lane
 *  where two would otherwise overlap — a tiny beeswarm. */
function lanes(xs: number[]): number[] {
  const last: number[] = Array.from({ length: LANES }, () => -Infinity);
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const lane = new Array<number>(xs.length).fill(0);
  for (const [x, i] of order) {
    let placed = false;
    for (let l = 0; l < LANES; l++) {
      if (x - last[l] >= DOT_GAP_PCT) {
        last[l] = x;
        lane[i] = l;
        placed = true;
        break;
      }
    }
    // Crowded past three lanes: cycle, so nothing lands on nothing.
    if (!placed) lane[i] = i % LANES;
  }
  return lane;
}

export function RevenueRange({
  comps,
  subjectAnnualRevenue,
  className,
}: {
  comps: StrComp[];
  subjectAnnualRevenue: number;
  className?: string;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const { values: revenues } = revenueBasis(comps);
  if (revenues.length === 0) return null;
  const q = revenueQuartiles(revenues);
  if (!q) return null;

  const lo = Math.min(q.min, subjectAnnualRevenue);
  const hi = Math.max(q.max, subjectAnnualRevenue);
  const pad = (hi - lo) * 0.06 || hi * 0.05 || 1;
  const min = lo - pad;
  const span = hi + pad - min;
  const pct = (v: number) => Math.round(((v - min) / span) * 1000) / 10;

  const below = revenues.filter((r) => r < subjectAnnualRevenue).length;
  const n = revenues.length;
  const xs = revenues.map(pct);
  const laneOf = lanes(xs);
  const subjectX = pct(subjectAnnualRevenue);

  const verdict =
    below === n
      ? "above every comp"
      : below === 0
        ? "below every comp"
        : subjectAnnualRevenue >= q.p75
          ? "in the top quarter"
          : subjectAnnualRevenue >= q.p50
            ? "above the median comp"
            : subjectAnnualRevenue >= q.p25
              ? "below the median comp"
              : "in the bottom quarter";

  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <MetricLabel hint={HINTS.revenueRange}>Where you sit among comps</MetricLabel>
        <StrengthMeter comps={comps} />
      </div>

      {/* The chart in words, and only the half a chart cannot say. The
          strip already shows where the figure lands; what it cannot
          show is the count, so that is what the line carries. */}
      <p className="mt-1.5 text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">{verdict}</span>, above{" "}
        <span className="tabular text-foreground">{below}</span> of{" "}
        <span className="tabular">{n}</span> nearby rentals.
      </p>

      {/* The strip. Percent positions, so text stays crisp at any width. */}
      <div className="relative mt-5 h-[62px]">
        {/* Your marker: a hairline and a plain label, not a badge. The
            pill it used to wear was the heaviest thing on the page and
            the only thing that did not need to be. */}
        <div
          className="absolute top-0 z-20 flex -translate-x-1/2 flex-col items-center"
          style={{ left: `${subjectX}%` }}
        >
          <span className="whitespace-nowrap px-1 text-[11px] font-semibold text-foreground tabular">
            {fmtMoneyShort(subjectAnnualRevenue)}
          </span>
          <span aria-hidden className="h-[38px] w-px bg-foreground/70" />
        </div>

        {/* Track, middle half, median. */}
        <div className="absolute inset-x-0 top-[24px] h-9">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-border" />
          <div
            className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-gold-fill/60"
            style={{ left: `${pct(q.p25)}%`, width: `${Math.max(0.5, pct(q.p75) - pct(q.p25))}%` }}
            title={`Middle half of comps: ${fmtMoneyShort(q.p25)} to ${fmtMoneyShort(q.p75)}`}
          />
          <div
            aria-hidden
            className="absolute top-1/2 h-3.5 w-px -translate-x-1/2 -translate-y-1/2 bg-gold"
            style={{ left: `${pct(q.p50)}%` }}
          />
          {/* One dot per comp, stacked where they crowd. */}
          {xs.map((x, i) => {
            const c = comps[i];
            const hot = hover === i;
            return (
              <button
                key={c?.id ?? i}
                type="button"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${c?.name ?? "Comp"}: ${fmtMoney(revenues[i])} a year`}
                className={cn(
                  "absolute size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform duration-150",
                  hot ? "z-30 scale-[1.7] bg-gold" : "bg-gold-fill/70 hover:scale-150"
                )}
                style={{ left: `${x}%`, top: `${50 + (laneOf[i] - 1) * 30}%` }}
              />
            );
          })}
        </div>

        {/* Axis labels under the strip. */}
        <div className="absolute inset-x-0 bottom-0 text-[10px] text-muted-foreground tabular">
          <span className="absolute left-0">{fmtMoneyShort(q.min)}</span>
          <span
            className="absolute -translate-x-1/2 whitespace-nowrap text-muted-foreground/80"
            style={{ left: `${pct(q.p50)}%` }}
          >
            median {fmtMoneyShort(q.p50)}
          </span>
          <span className="absolute right-0">{fmtMoneyShort(q.max)}</span>
        </div>

        {/* Hover card for a comp. */}
        {hover !== null && comps[hover] ? (
          <div
            className="pointer-events-none absolute top-[58px] z-40 w-max max-w-[16rem] -translate-x-1/2 rounded-sm border border-border bg-card px-2.5 py-1.5 text-[11px] shadow-md"
            style={{ left: `${Math.min(92, Math.max(8, xs[hover]))}%` }}
          >
            <p className="truncate font-medium text-foreground">{comps[hover].name}</p>
            <p className="text-muted-foreground tabular">
              {fmtMoney(revenues[hover])}/yr · {fmtMoney(comps[hover].adr)} a night ·{" "}
              {fmtPct(comps[hover].occupancy)} booked
            </p>
          </div>
        ) : null}
      </div>

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
