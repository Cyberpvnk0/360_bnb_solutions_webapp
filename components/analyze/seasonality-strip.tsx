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
 * So the bars are net cash flow, not revenue: the question is not "when
 * is it busy" but "when does this not pay for itself". Months below the
 * line are drawn in the same muted red the breakeven gauge uses when a
 * deal doesn't clear, because they mean the same thing.
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

  const peak = Math.max(...months.map((m) => Math.abs(m.net)), 1);

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
          <MonthBar key={m.month} month={m} peak={peak} />
        ))}
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

function MonthBar({ month, peak }: { month: MonthOutlook; peak: number }) {
  const negative = month.net < 0;
  // A floor so a near-zero month is still a visible mark rather than a
  // gap that reads as missing data.
  const height = Math.max(3, (Math.abs(month.net) / peak) * 46);

  return (
    <div
      role="listitem"
      className="flex flex-1 flex-col items-center gap-1"
      title={`${month.label}: ${fmtMoney(month.net)} at ${fmtPct(month.occupancy)} occupancy${
        month.capped ? " (capped at a full calendar)" : ""
      }`}
    >
      {/* Above the line */}
      <div className="flex h-[46px] w-full items-end justify-center">
        {negative ? null : (
          <div
            style={{ height }}
            className="w-full rounded-t-xs bg-gold-fill/70"
          />
        )}
      </div>
      <div className="h-px w-full bg-border" />
      {/* Below it */}
      <div className="flex h-[46px] w-full items-start justify-center">
        {negative ? (
          <div
            style={{ height, backgroundColor: "var(--red-muted)" }}
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
