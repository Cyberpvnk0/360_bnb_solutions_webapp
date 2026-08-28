"use client";

/**
 * Every saved deal, against what its market actually runs.
 *
 * The pipeline card counts deals; this one says whether they are any
 * good. Each row is the analyzer's gauge unrolled into a line: the gold
 * fill is the occupancy the deal has to hit to cover its costs, the
 * grey tick is what the market measured, and the gap between them is
 * the margin of safety. Same colours, same threshold, same words as the
 * gauge — a deal should read identically here and on its own page.
 *
 * A market with no measured occupancy gets no tick and no verdict. The
 * bar still shows the breakeven, because that comes from the deal's own
 * numbers; the row simply declines to grade it.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Deal } from "@/lib/mock/types";
import { fmtMoney, fmtPct } from "@/lib/format";
import { MetricLabel } from "@/components/primitives/metric-label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Matches the gauge: two occupancy points of headroom is "comfortable". */
const COMFORTABLE_PTS = 2;

/** How many rows the desk shows before sending you to the pipeline. */
const MAX_ROWS = 5;

function CushionBar({
  breakeven,
  marketOccupancy,
}: {
  breakeven: number;
  marketOccupancy: number | null;
}) {
  const clamp = (n: number) => Math.min(Math.max(n, 0), 1);
  // A deal that never breaks even has an infinite breakeven; a full bar
  // is the honest picture of that.
  const fill = Number.isFinite(breakeven) ? clamp(breakeven) : 1;
  const short =
    marketOccupancy !== null &&
    (marketOccupancy - breakeven) * 100 < COMFORTABLE_PTS;

  return (
    <div className="relative h-1.5 w-full rounded-full bg-secondary">
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
        style={{
          width: `${fill * 100}%`,
          background: short ? "var(--chart-neg)" : "var(--chart-primary)",
        }}
      />
      {marketOccupancy !== null ? (
        // 2px of surface around the tick so it reads as a separate mark
        // wherever it lands on the fill.
        <span
          aria-hidden
          className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${clamp(marketOccupancy) * 100}%`,
            background: "var(--chart-comparison)",
            boxShadow: "0 0 0 2px var(--card)",
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * One row, in two shapes.
 *
 * Wide: property, bar, money — three columns, aligned with the header.
 * Narrow: property and money on one line with the bar spanning beneath,
 * because a 9rem bar and a 6rem money column leave a phone nothing for
 * the address. The DOM order is property, money, bar and the wide
 * layout places the bar back into the middle column, so both shapes
 * read in the order the header names.
 */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 md:grid-cols-[minmax(0,1.5fr)_minmax(9rem,1.4fr)_minmax(6rem,0.8fr)] md:items-center md:gap-x-5 md:gap-y-0";

function DealRow({
  deal,
  marketOccupancy,
}: {
  deal: Deal;
  marketOccupancy: number | null;
}) {
  const cushionPts =
    marketOccupancy === null || !Number.isFinite(deal.breakevenOccupancy)
      ? null
      : Math.round((marketOccupancy - deal.breakevenOccupancy) * 100);

  return (
    <Link
      href="/pipeline"
      className={cn(
        ROW_GRID,
        "px-6 py-4 transition-colors duration-150 hover:bg-secondary/40"
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {deal.address}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {deal.city}, {deal.stateCode}
        </p>
      </div>

      <div className="text-right md:col-start-3 md:row-start-1">
        <p className="text-sm text-foreground tabular">
          {fmtMoney(deal.netCashFlow)}
          <span className="text-muted-foreground">/mo</span>
        </p>
        {/* The verdict in words, so it never rides on the bar's colour. */}
        <p className="text-[11px] text-muted-foreground tabular">
          {cushionPts === null
            ? "Not graded"
            : cushionPts >= COMFORTABLE_PTS
              ? `${cushionPts} pts cushion`
              : `${Math.abs(cushionPts)} pts short`}
        </p>
      </div>

      <div className="col-span-2 min-w-0 md:col-span-1 md:col-start-2 md:row-start-1">
        <CushionBar
          breakeven={deal.breakevenOccupancy}
          marketOccupancy={marketOccupancy}
        />
        <p className="mt-1.5 truncate text-[11px] text-muted-foreground tabular">
          {Number.isFinite(deal.breakevenOccupancy)
            ? `Breakeven ${fmtPct(deal.breakevenOccupancy)}`
            : "Never breaks even"}
          {marketOccupancy === null
            ? " · market not measured yet"
            : ` · market runs ${fmtPct(marketOccupancy)}`}
        </p>
      </div>
    </Link>
  );
}

export function DealBoard({
  deals,
  marketOccupancy,
  statsReady,
}: {
  deals: Deal[];
  marketOccupancy: (slug: string) => number | null;
  /** False while the measured figures are still on their way. Rows draw
   *  a skeleton rather than briefly grading every deal "not measured". */
  statsReady: boolean;
}) {
  // Worst cushion first: the deal that needs a decision leads. Deals
  // with no measured market sort last — no verdict, no urgency.
  const ranked = [...deals].sort((a, b) => {
    const ao = marketOccupancy(a.marketSlug);
    const bo = marketOccupancy(b.marketSlug);
    if (ao === null && bo === null) return 0;
    if (ao === null) return 1;
    if (bo === null) return -1;
    return ao - a.breakevenOccupancy - (bo - b.breakevenOccupancy);
  });
  const shown = ranked.slice(0, MAX_ROWS);

  return (
    <section
      aria-labelledby="deal-board-title"
      className="overflow-hidden rounded-sm border border-border bg-card"
    >
      <div className="flex items-baseline justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h2 id="deal-board-title" className="text-sm font-semibold text-foreground">
            Your deals
          </h2>
          {/* Said out loud, because the headroom tile names the best
              deal and this list leads with the worst — two true
              statements that look like a contradiction otherwise. */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            Thinnest cushion first
          </p>
        </div>
        <Link
          href="/pipeline"
          className="inline-flex items-center gap-1 text-xs font-medium text-gold transition-colors duration-150 hover:text-gold-bright"
        >
          {deals.length > MAX_ROWS ? `All ${deals.length}` : "Pipeline"}
          <ArrowRight aria-hidden className="size-3" />
        </Link>
      </div>

      {/* Narrow rows stack, so their column headings would name the
          wrong things. The row labels its own parts there instead. */}
      <div className="hidden border-b border-border bg-secondary/60 px-6 py-2 md:grid md:grid-cols-[minmax(0,1.5fr)_minmax(9rem,1.4fr)_minmax(6rem,0.8fr)] md:items-center md:gap-x-5">
        <MetricLabel>Property</MetricLabel>
        <MetricLabel>Breakeven vs market</MetricLabel>
        <MetricLabel className="text-right">Cash flow</MetricLabel>
      </div>

      <div className="divide-y divide-border">
        {statsReady
          ? shown.map((deal) => (
              <DealRow
                key={deal.id}
                deal={deal}
                marketOccupancy={marketOccupancy(deal.marketSlug)}
              />
            ))
          : shown.map((deal) => (
              <div key={deal.id} className="px-6 py-4">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="mt-2 h-3 w-32" />
              </div>
            ))}
      </div>
    </section>
  );
}
