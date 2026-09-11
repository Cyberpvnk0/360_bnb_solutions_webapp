"use client";

/**
 * The year, month by month — one bar per month, one measure, one scale.
 *
 * What this replaces drew two rows of bars on two different scales
 * (revenue above, net below, "scaled separately") and left the reader
 * to work out which was which. A student underwriting a lease asks one
 * question of a calendar: which months make money and which lose it.
 * So: net cash flow per month, up from a shared zero line in gold and
 * down from it in red, with the dollar figure on every bar. The
 * sentence at the top says the answer before the bars do.
 *
 * Seasonality is this address's own: the feed's twelve-month revenue
 * distribution, applied to the market occupancy the projection uses.
 */

import * as React from "react";
import {
  monthlyOutlook,
  seasonalRisk,
  type MonthOutlook,
} from "@/lib/calc/seasonality";
import type { DealInputs, MarketAssumptions } from "@/lib/calc/arbitrage";
import { fmtMoney, fmtMoneyShort, fmtPct } from "@/lib/format";
import { MetricLabel } from "@/components/primitives/metric-label";
import { HINTS } from "@/lib/copy/hints";
import { cn } from "@/lib/utils";

/** Pixel height of each half of the chart (above and below zero). */
const HALF = 52;

export function SeasonalityStrip({
  inputs,
  assumptions,
  weights,
  className,
}: {
  inputs: DealInputs;
  assumptions: MarketAssumptions;
  weights: number[] | undefined;
  className?: string;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const months = weights ? monthlyOutlook(inputs, assumptions, weights) : null;
  if (!months) return null;
  const risk = seasonalRisk(months);
  if (!risk) return null;

  const peak = Math.max(...months.map((m) => Math.abs(m.net)), 1);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <MetricLabel hint={HINTS.seasonality}>Cash flow by month</MetricLabel>
        <span className="text-[11px] text-muted-foreground tabular">
          Net <span className="font-medium text-foreground">{fmtMoneyShort(risk.annualNet)}</span>{" "}
          on <span className="text-foreground">{fmtMoneyShort(risk.annualRevenue)}</span> gross for
          the year
        </span>
      </div>

      {/* The answer, in one line. The months that lose money are named
          on the chart itself, in red, under their own bars — listing
          them again in prose was the same fact printed twice. */}
      <p className="mt-1.5 text-[13px] text-muted-foreground">
        {risk.negativeMonths === 0 ? (
          <>
            <span className="font-medium text-foreground">Every month clears its costs.</span>{" "}
            Thinnest is {risk.weakest.label} at{" "}
            <span className="tabular text-foreground">{fmtMoney(risk.weakest.net)}</span>.
          </>
        ) : (
          <>
            <span className="font-medium text-neg">
              {risk.negativeMonths} {risk.negativeMonths === 1 ? "month loses" : "months lose"} money
            </span>
            {risk.longestNegativeRun > 1 ? `, ${risk.longestNegativeRun} in a row` : ""}. Keep{" "}
            <span className="tabular text-foreground">{fmtMoney(risk.worstCaseDrawdown)}</span> on
            hand to carry them.
          </>
        )}
      </p>

      {/* One bar per month from a shared zero line. */}
      <div className="relative mt-5">
        <div className="flex items-stretch gap-1" role="list">
          {months.map((m, i) => (
            <MonthBar
              key={m.month}
              month={m}
              peak={peak}
              hot={hover === i}
              named={m.month === risk.strongest.month || m.month === risk.weakest.month}
              onHover={(on) => setHover(on ? i : null)}
            />
          ))}
        </div>
        {hover !== null ? (
          <div
            className="pointer-events-none absolute -top-2 z-20 w-max -translate-x-1/2 -translate-y-full rounded-sm border border-border bg-card px-2.5 py-1.5 text-[11px] shadow-md"
            style={{ left: `${((hover + 0.5) / months.length) * 100}%` }}
          >
            <p className="font-medium text-foreground">{months[hover].label}</p>
            <p className="text-muted-foreground tabular">
              {fmtMoney(months[hover].revenue)} revenue · {fmtMoney(months[hover].net)} net ·{" "}
              {fmtPct(months[hover].occupancy)} booked
              {months[hover].capped ? " (full calendar)" : ""}
            </p>
          </div>
        ) : null}
      </div>

    </div>
  );
}

function MonthBar({
  month,
  peak,
  hot,
  named,
  onHover,
}: {
  month: MonthOutlook;
  peak: number;
  hot: boolean;
  /** The best or the thinnest month: the two whose figure a phone
   *  still prints, the sentence above having named them. */
  named: boolean;
  onHover: (on: boolean) => void;
}) {
  const negative = month.net < 0;
  // A floor so a near-zero month is still a visible mark rather than a
  // gap that reads as missing data.
  const h = Math.max(3, (Math.abs(month.net) / peak) * (HALF - 18));

  return (
    <button
      type="button"
      role="listitem"
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      aria-label={`${month.label}: ${fmtMoney(month.net)} net on ${fmtMoney(month.revenue)} revenue`}
      className="group flex min-w-0 flex-1 flex-col items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
    >
      {/* Above the line: the figure, then the bar (positive only). */}
      <div className="flex w-full flex-col items-center justify-end" style={{ height: HALF }}>
        {!negative ? (
          <>
            <span
              className={cn(
                "mb-1 text-[10px] font-medium tabular",
                hot ? "text-foreground" : "text-muted-foreground",
                !named && !hot && "invisible"
              )}
            >
              {fmtMoneyShort(month.net)}
            </span>
            <div
              style={{ height: h }}
              className={cn(
                "w-[58%] max-w-9 rounded-t-[3px] bg-gold-fill transition-opacity duration-150",
                hot ? "opacity-100" : "opacity-70"
              )}
            />
          </>
        ) : null}
      </div>
      <div className="h-px w-full bg-border" />
      {/* Below the line: the bar, then the figure (negative only). */}
      <div className="flex w-full flex-col items-center justify-start" style={{ height: HALF }}>
        {negative ? (
          <>
            <div
              style={{ height: h, backgroundColor: "var(--red)" }}
              className={cn(
                "w-[58%] max-w-9 rounded-b-[3px] transition-opacity duration-150",
                hot ? "opacity-100" : "opacity-70"
              )}
            />
            <span className={cn("mt-1 text-[10px] font-medium text-neg tabular", !named && !hot && "invisible")}>
              −{fmtMoneyShort(Math.abs(month.net))}
            </span>
          </>
        ) : null}
      </div>
      <span
        className={cn(
          "mt-1.5 text-[10px] tabular transition-colors duration-150",
          hot ? "text-foreground" : negative ? "text-neg/80" : "text-muted-foreground"
        )}
      >
        {month.label}
      </span>
    </button>
  );
}
