"use client";

import * as React from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { getMarkets } from "@/lib/data";
import type { Market } from "@/lib/mock/types";
import { revpar } from "@/lib/calc/arbitrage";
import { fmtDeltaPct, fmtDeltaPts, fmtMoney, fmtPct } from "@/lib/format";
import { DeltaIndicator } from "@/components/primitives/delta-indicator";
import { EmptyState } from "@/components/primitives/empty-state";
import { MetricLabel } from "@/components/primitives/metric-label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Every row is its own grid, so all tracks must resolve identically
// across rows: minmax+fr keeps numeric columns aligned.
const ROW_GRID =
  "grid grid-cols-[minmax(8rem,1.4fr)_minmax(5rem,1fr)_minmax(6rem,1fr)_minmax(4.5rem,0.9fr)] items-center gap-x-4";

/**
 * The markets the operator is watching: ADR, occupancy and RevPAR for
 * each, resolved from the market dataset.
 */
export function WatchedMarkets({ slugs }: { slugs: string[] }) {
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

  const watched = bySlug
    ? slugs
        .map((slug) => bySlug.get(slug))
        .filter((m): m is Market => Boolean(m))
    : null;

  return (
    <section aria-labelledby="watched-markets-title">
      <div className="flex items-baseline justify-between gap-4">
        <MetricLabel id="watched-markets-title">Watched markets</MetricLabel>
        <Link
          href="/markets"
          className="text-xs font-medium text-gold transition-colors duration-150 hover:text-gold-bright"
        >
          Manage
        </Link>
      </div>

      {slugs.length === 0 ? (
        <EmptyState
          className="mt-3"
          icon={Eye}
          title="You're not watching any markets"
          description="Watch a market to keep its ADR, occupancy and RevPAR on your desk."
          action={
            <Button asChild variant="outline">
              <Link href="/markets">Browse markets</Link>
            </Button>
          }
        />
      ) : (
        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[560px]">
            <div className={cn(ROW_GRID, "border-y border-border px-3 py-2")}>
              <MetricLabel>Market</MetricLabel>
              <MetricLabel>ADR</MetricLabel>
              <MetricLabel>Occupancy</MetricLabel>
              <MetricLabel>RevPAR</MetricLabel>
            </div>
            <div className="divide-y divide-border border-b border-border">
              {watched === null
                ? slugs.map((slug) => (
                    <div key={slug} className={cn(ROW_GRID, "px-3 py-3.5")}>
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
                : watched.map((m) => (
                    <Link
                      key={m.slug}
                      href={`/markets/${m.slug}`}
                      className={cn(
                        ROW_GRID,
                        "px-3 py-3.5 transition-colors duration-150 hover:bg-secondary/40"
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {m.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {m.state}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-foreground tabular">
                          {fmtMoney(m.adr)}
                        </p>
                        <DeltaIndicator
                          value={m.deltas.adr}
                          label={fmtDeltaPct(m.deltas.adr)}
                        />
                      </div>
                      <div>
                        <p className="text-sm text-foreground tabular">
                          {fmtPct(m.occupancy)}
                        </p>
                        <DeltaIndicator
                          value={m.deltas.occupancy}
                          label={fmtDeltaPts(m.deltas.occupancy)}
                        />
                      </div>
                      <div>
                        <p className="text-sm text-foreground tabular">
                          {fmtMoney(revpar(m.adr, m.occupancy))}
                        </p>
                        <p className="text-xs text-muted-foreground">per night</p>
                      </div>
                    </Link>
                  ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
