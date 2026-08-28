"use client";

import * as React from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { getMarkets } from "@/lib/data";
import type { Market } from "@/lib/mock/types";
import { displayFigures } from "@/lib/live/market-figures";
import { fmtDayMonth, fmtDeltaPct, fmtDeltaPts, fmtMoney, fmtPct } from "@/lib/format";
import { DeltaIndicator } from "@/components/primitives/delta-indicator";
import { EmptyState } from "@/components/primitives/empty-state";
import { MetricLabel } from "@/components/primitives/metric-label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { MarketStatsBySlug } from "./use-market-stats";

// Every row is its own grid, so all tracks must resolve identically
// across rows: minmax+fr keeps numeric columns aligned.
const ROW_GRID =
  "grid grid-cols-[minmax(10rem,1.8fr)_minmax(5rem,1fr)_minmax(6rem,1fr)_minmax(4.5rem,0.9fr)] items-center gap-x-4";

/**
 * Watched-markets module: ADR, occupancy and RevPAR for every market the
 * operator watches, in a card with rows flush to its edges.
 *
 * Two sources, never mixed inside one row. Where the store holds a
 * measured summary the row shows it and dates it; where it doesn't, the
 * row shows the model and says so. The month-over-month deltas are part
 * of the model, so a measured row carries none — a real level with an
 * invented trend under it reads as one measurement and is two.
 */
export function WatchedMarkets({
  slugs,
  liveStats = {},
  statsReady = true,
}: {
  slugs: string[];
  /** Measured figures by slug, for whichever of these markets the store
   *  has already paid for. Free to read; no vendor call. */
  liveStats?: MarketStatsBySlug;
  statsReady?: boolean;
}) {
  const [bySlug, setBySlug] = React.useState<Map<string, Market> | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getMarkets().then((all) => {
      if (cancelled) return;
      setBySlug(new Map(all.map((m) => [m.slug, m])));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const watched =
    bySlug && statsReady
      ? slugs
          .map((slug) => bySlug.get(slug))
          .filter((m): m is Market => Boolean(m))
      : null;

  return (
    <section
      aria-labelledby="watched-markets-title"
      className="overflow-hidden rounded-sm border border-border bg-card"
    >
      <div className="flex items-baseline justify-between gap-4 border-b border-border px-6 py-4">
        <h2
          id="watched-markets-title"
          className="text-sm font-semibold text-foreground"
        >
          Watched markets
        </h2>
        <Link
          href="/deals"
          className="text-xs font-medium text-gold transition-colors duration-150 hover:text-gold-bright"
        >
          Manage
        </Link>
      </div>

      {slugs.length === 0 ? (
        <div className="p-6">
          <EmptyState
            icon={Eye}
            title="You're not watching any markets"
            description="Watch a market to keep its ADR, occupancy and RevPAR on your desk."
            action={
              <Button asChild variant="outline">
                <Link href="/deals">Browse markets</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            <div
              className={cn(
                ROW_GRID,
                "border-b border-border bg-secondary/60 px-6 py-2"
              )}
            >
              <MetricLabel>Market</MetricLabel>
              <MetricLabel>ADR</MetricLabel>
              <MetricLabel>Occupancy</MetricLabel>
              <MetricLabel>RevPAR</MetricLabel>
            </div>
            <div className="divide-y divide-border">
              {watched === null
                ? slugs.map((slug) => (
                    <div key={slug} className={cn(ROW_GRID, "px-6 py-3.5")}>
                      <div>
                        <Skeleton className="h-5 w-24" />
                        <Skeleton className="mt-1 h-3 w-14" />
                      </div>
                      <div>
                        <Skeleton className="h-5 w-12" />
                        <Skeleton className="mt-2 h-4 w-10" />
                      </div>
                      <div>
                        <Skeleton className="h-5 w-10" />
                        <Skeleton className="mt-2 h-4 w-12" />
                      </div>
                      <div>
                        <Skeleton className="h-5 w-12" />
                        <Skeleton className="mt-1 h-3 w-12" />
                      </div>
                    </div>
                  ))
                : watched.map((m) => {
                    const f = displayFigures(
                      m,
                      liveStats[m.slug],
                      liveStats[m.slug]?.asOf ?? null
                    );
                    return (
                      <Link
                        key={m.slug}
                        href={`/deals?market=${m.slug}`}
                        className={cn(
                          ROW_GRID,
                          "px-6 py-3.5 transition-colors duration-150 hover:bg-secondary/40"
                        )}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {m.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {m.state}
                            {" · "}
                            {f.measured ? (
                              <span className="text-gold">
                                {/* Dated, never dressed up as now. The
                                    year is dropped on purpose: the store
                                    ages rows out inside a month, and the
                                    six extra characters were enough to
                                    truncate the whole line. */}
                                Measured{f.asOf ? ` ${fmtDayMonth(f.asOf)}` : ""}
                              </span>
                            ) : (
                              "Modelled"
                            )}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-foreground tabular">
                            {fmtMoney(f.adr)}
                          </p>
                          {f.measured ? null : (
                            <DeltaIndicator
                              value={m.deltas.adr}
                              label={fmtDeltaPct(m.deltas.adr)}
                            />
                          )}
                        </div>
                        <div>
                          <p className="text-sm text-foreground tabular">
                            {fmtPct(f.occupancy)}
                          </p>
                          {f.measured ? null : (
                            <DeltaIndicator
                              value={m.deltas.occupancy}
                              label={fmtDeltaPts(m.deltas.occupancy)}
                            />
                          )}
                        </div>
                        <div>
                          <p className="text-sm text-foreground tabular">
                            {fmtMoney(f.revpar)}
                          </p>
                          <p className="text-xs text-muted-foreground">per night</p>
                        </div>
                      </Link>
                    );
                  })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
