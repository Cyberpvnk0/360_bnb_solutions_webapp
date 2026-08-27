"use client";

/**
 * The year, month by month.
 *
 * Everything else on this screen is an annual average, and an average
 * is exactly where a seasonal deal hides. A property can clear its
 * costs comfortably across twelve months and still lose money for four
 * of them in a row — and rent is due monthly, in cash, whether or not
 * September cooperated.
 *
 * Two rows, because the two answer different questions and the gap
 * between them is the cost of operating. Revenue on top says when the
 * property is busy. Net below says when it actually pays for itself,
 * and a strong revenue month can still be a losing one — which is the
 * whole reason not to show revenue alone.
 *
 * They are scaled independently and labelled as such. Net is a small
 * fraction of revenue, so a shared axis would flatten it into a line
 * and hide the sign changes that matter most.
 *
 * Months below zero are drawn in the same muted red the breakeven gauge
 * uses when a deal doesn't clear, because they mean the same thing.
 *
 * Only drawn when the feed supplied a real distribution for this
 * address. A seeded season rendered with the same confidence as a
 * measured one is decoration that gets somebody to sign a lease.
 */

import {
  monthlyOutlook,
  seasonalRisk,
  type MonthOutlook,
} from "@/lib/calc/seasonality";
import type { DealInputs, MarketAssumptions } from "@/lib/calc/arbitrage";
import { fmtMoney, fmtMoneyShort, fmtPct } from "@/lib/format";
import { MetricLabel } from "@/components/primitives/metric-label";
import { cn } from "@/lib/utils";

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
  const months = weights ? monthlyOutlook(inputs, assumptions, weights) : null;
  if (!months) return null;
  const risk = seasonalRisk(months);
  if (!risk) return null;

  const netPeak = Math.max(...months.map((m) => Math.abs(m.net)), 1);
  const revPeak = Math.max(...months.map((m) => m.revenue), 1);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <MetricLabel>Cash flow by month</MetricLabel>
        <span className="text-[11px] text-muted-foreground">
          {risk.negativeMonths === 0 ? (
            <>Every month clears its costs</>
          ) : (
            <>
              <span className="font-medium text-foreground">
                {risk.negativeMonths}
              </span>{" "}
              {risk.negativeMonths === 1 ? "month" : "months"} below zero
              {risk.longestNegativeRun > 1 ? (
                <>
                  {" "}
                  ·{" "}
                  <span className="font-medium text-foreground">
                    {risk.longestNegativeRun}
                  </span>{" "}
                  in a row
                </>
              ) : null}
            </>
          )}
        </span>
      </div>

      <div className="mt-3 flex items-end gap-1.5" role="list">
        {months.map((m) => (
          <MonthBar key={m.month} month={m} netPeak={netPeak} revPeak={revPeak} />
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-3 rounded-xs bg-gold-fill/30" />
          Gross revenue · {fmtMoneyShort(risk.annualRevenue)}/yr
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-3 rounded-xs bg-gold-fill/80" />
          Net cash flow · {fmtMoneyShort(risk.annualNet)}/yr
        </span>
        <span>Scaled separately — net is a fraction of revenue.</span>
      </div>

      <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
        {risk.negativeMonths > 0 ? (
          <>
            The weak stretch costs{" "}
            <span className="tabular font-medium text-foreground">
              {fmtMoney(risk.worstCaseDrawdown)}
            </span>{" "}
            out of pocket before the strong months repay it — cash you need
            on hand, not just on the year.{" "}
          </>
        ) : null}
        Strongest is {risk.strongest.label} at{" "}
        <span className="tabular text-foreground">
          {fmtMoneyShort(risk.strongest.net)}
        </span>
        , weakest {risk.weakest.label} at{" "}
        <span className="tabular text-foreground">
          {fmtMoneyShort(risk.weakest.net)}
        </span>
        . Seasonality is this address&apos;s own, applied to occupancy.
      </p>
    </div>
  );
}

function MonthBar({
  month,
  netPeak,
  revPeak,
}: {
  month: MonthOutlook;
  netPeak: number;
  revPeak: number;
}) {
  const negative = month.net < 0;
  // A floor so a near-zero month is still a visible mark rather than a
  // gap that reads as missing data.
  const netH = Math.max(3, (Math.abs(month.net) / netPeak) * 40);
  const revH = Math.max(3, (month.revenue / revPeak) * 34);

  return (
    <div
      role="listitem"
      className="flex flex-1 flex-col items-center gap-1"
      title={`${month.label}: ${fmtMoney(month.revenue)} revenue, ${fmtMoney(month.net)} net, at ${fmtPct(month.occupancy)} occupancy${
        month.capped ? " (capped at a full calendar)" : ""
      }`}
    >
      {/* Revenue, always positive, its own scale. */}
      <div className="flex h-[34px] w-full items-end justify-center">
        <div style={{ height: revH }} className="w-full rounded-t-xs bg-gold-fill/25" />
      </div>
      {/* Net above the line */}
      <div className="flex h-[40px] w-full items-end justify-center">
        {negative ? null : (
          <div
            style={{ height: netH }}
            className="w-full rounded-t-xs bg-gold-fill/80"
          />
        )}
      </div>
      <div className="h-px w-full bg-border" />
      {/* Net below it */}
      <div className="flex h-[40px] w-full items-start justify-center">
        {negative ? (
          <div
            style={{ height: netH, backgroundColor: "var(--red-muted)" }}
            className="w-full rounded-b-xs opacity-80"
          />
        ) : null}
      </div>
      <span
        className={cn(
          "text-[9px] tabular",
          negative ? "font-medium text-foreground" : "text-muted-foreground"
        )}
      >
        {month.label}
      </span>
    </div>
  );
}
