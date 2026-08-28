"use client";

/**
 * The four numbers worth knowing before anything else.
 *
 * Stat tiles, not charts. Each of these is a single figure, and a
 * single figure drawn as a chart is decoration — the form follows the
 * data's job, and this job is "tell me the number".
 *
 * What they answer, in the order somebody actually asks:
 *   1. What are my signed units paying me a month?
 *   2. How many of them are actually live?
 *   3. Which saved deal has the most room for error?
 *   4. Is anything I have saved underwater?
 *
 * The last is a status, so it is never colour alone: it carries an icon
 * and the word, because a red number to someone who cannot see red is
 * just a number. It has three states, not two — a deal whose market has
 * never been measured is unchecked, and calling it clear would be a
 * verdict reached from no evidence.
 */

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckCircle2, HelpCircle } from "lucide-react";
import type { Deal } from "@/lib/mock/types";
import { fmtMoney } from "@/lib/format";
import { MetricLabel } from "@/components/primitives/metric-label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface PortfolioStats {
  monthlyCashFlow: number;
  liveCount: number;
  /** Deals whose market has a measured occupancy — the only ones the
   *  cushion figures below are allowed to speak about. */
  assessed: number;
  bestDeal: { deal: Deal; cushionPts: number } | null;
  atRisk: Deal[];
}

/**
 * The portfolio, from the deals themselves.
 *
 * Cushion is the market's measured occupancy minus the deal's
 * breakeven — the same margin of safety the analyzer's gauge shows, so
 * a deal reads the same here as it did when it was saved.
 */
export function portfolioStats(
  deals: Deal[],
  marketOccupancy: (slug: string) => number | null
): PortfolioStats {
  const live = deals.filter((d) => d.stage === "live");

  let best: { deal: Deal; cushionPts: number } | null = null;
  const atRisk: Deal[] = [];
  let assessed = 0;

  for (const deal of deals) {
    const occ = marketOccupancy(deal.marketSlug);
    // No occupancy means no opinion. A deal is not "at risk" because we
    // failed to look up its market.
    if (occ === null || !Number.isFinite(deal.breakevenOccupancy)) continue;
    assessed += 1;
    const cushionPts = Math.round((occ - deal.breakevenOccupancy) * 100);
    if (cushionPts < 0) atRisk.push(deal);
    if (!best || cushionPts > best.cushionPts) best = { deal, cushionPts };
  }

  return {
    monthlyCashFlow: live.reduce((sum, d) => sum + d.netCashFlow, 0),
    liveCount: live.length,
    assessed,
    bestDeal: best,
    atRisk,
  };
}

function Tile({
  label,
  children,
  sub,
  href,
}: {
  label: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <MetricLabel>{label}</MetricLabel>
      <div className="mt-1.5 font-display text-2xl font-medium leading-tight tracking-tight text-foreground md:text-[1.75rem]">
        {children}
      </div>
      {sub ? (
        <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {sub}
        </div>
      ) : null}
    </>
  );

  return href ? (
    <Link
      href={href}
      className="group block px-5 py-5 transition-colors duration-150 hover:bg-secondary/30"
    >
      {body}
    </Link>
  ) : (
    <div className="px-5 py-5">{body}</div>
  );
}

export function PortfolioTiles({
  stats,
  statsReady,
  className,
}: {
  stats: PortfolioStats;
  /** False while measured market figures are in flight. The two cash
   *  tiles never wait on them; the two cushion tiles must. */
  statsReady: boolean;
  className?: string;
}) {
  const { monthlyCashFlow, liveCount, assessed, bestDeal, atRisk } = stats;

  return (
    <section
      aria-label="Portfolio at a glance"
      className={cn(
        "grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-sm border border-border bg-card lg:grid-cols-4 lg:divide-y-0",
        className
      )}
    >
      <Tile
        label="Monthly cash flow"
        href="/pipeline"
        sub={
          liveCount === 0
            ? "Nothing live yet"
            : `Across ${liveCount} live ${liveCount === 1 ? "unit" : "units"}`
        }
      >
        <span className="tabular">{fmtMoney(monthlyCashFlow)}</span>
      </Tile>

      <Tile
        label="Deals live"
        href="/pipeline"
        sub={liveCount === 0 ? "Move one to Live when it signs" : "Signed and operating"}
      >
        <span className="tabular">{liveCount}</span>
      </Tile>

      <Tile
        label="Most headroom"
        href={bestDeal ? "/pipeline" : "/analyze"}
        sub={
          !statsReady ? (
            <Skeleton className="h-3 w-28" />
          ) : bestDeal ? (
            <span className="truncate">{bestDeal.deal.address}</span>
          ) : (
            "No measured market yet"
          )
        }
      >
        {!statsReady ? (
          <Skeleton className="h-7 w-20" />
        ) : bestDeal ? (
          <span className="tabular">
            {bestDeal.cushionPts > 0 ? "+" : ""}
            {bestDeal.cushionPts} pts
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Tile>

      {/* A status, so never colour alone: an icon and a word carry it
          too. And never a verdict without evidence — nothing measured
          means nothing graded, which is its own third state. */}
      <Tile
        label="Needs attention"
        href="/pipeline"
        sub={
          !statsReady ? (
            <Skeleton className="h-3 w-32" />
          ) : assessed === 0 ? (
            "No market figures to check against"
          ) : atRisk.length === 0 ? (
            `All ${assessed} checked ${assessed === 1 ? "deal clears" : "deals clear"} their costs`
          ) : (
            "Breakeven above what the market runs"
          )
        }
      >
        {!statsReady ? (
          <Skeleton className="h-7 w-24" />
        ) : assessed === 0 ? (
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <HelpCircle aria-hidden className="size-5 shrink-0" />
            <span>Unchecked</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            {atRisk.length === 0 ? (
              <CheckCircle2
                aria-hidden
                className="size-5 shrink-0"
                style={{ color: "var(--gold-fill)" }}
              />
            ) : (
              <AlertTriangle
                aria-hidden
                className="size-5 shrink-0"
                style={{ color: "var(--red-muted)" }}
              />
            )}
            <span className="tabular">
              {atRisk.length === 0 ? "All clear" : atRisk.length}
            </span>
          </span>
        )}
      </Tile>
    </section>
  );
}

/**
 * A first-run panel that says what to do, rather than four zeroes.
 *
 * Two columns on a wide screen, because one column of copy inside a
 * full-width card is most of a dashboard's worth of empty space — the
 * exact impression the panel exists to avoid. The right-hand column is
 * the three steps, not a chart of nothing.
 */
export function EmptyDesk() {
  const steps = [
    {
      title: "Search an address",
      body: "Any US rental. Beds and baths are detected for you.",
    },
    {
      title: "Read the real numbers",
      body: "Nightly rates, occupancy and month-by-month cash flow from listings around it.",
    },
    {
      title: "Save what's worth a call",
      body: "Saved deals land in your pipeline and on this page.",
    },
  ];

  return (
    <section className="overflow-hidden rounded-sm border border-border bg-card">
      <div className="grid gap-10 px-6 py-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-14 md:px-8 md:py-10">
        <div>
          <MetricLabel>Nothing saved yet</MetricLabel>
          <h2 className="mt-2 font-display text-xl font-medium tracking-tight text-foreground md:text-2xl">
            Start with one address
          </h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
            Analyze a property and you get its real nightly rates, occupancy and
            month-by-month cash flow from listings around it. Save the ones worth
            a call and they show up here.
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link
              href="/analyze"
              className="inline-flex h-10 items-center gap-1.5 rounded-sm bg-gold-fill px-4 text-sm font-medium text-background transition-opacity duration-150 hover:opacity-90"
            >
              Analyze an address
              <ArrowUpRight aria-hidden className="size-4" />
            </Link>
            <Link
              href="/deals"
              className="inline-flex h-10 items-center gap-1.5 rounded-sm border border-border px-4 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-secondary/50"
            >
              Browse rentals
            </Link>
          </div>
        </div>

        <ol className="flex flex-col gap-5 border-t border-border pt-8 md:border-l md:border-t-0 md:pl-14 md:pt-0">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-3.5">
              <span
                aria-hidden
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-medium text-muted-foreground tabular"
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{step.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
