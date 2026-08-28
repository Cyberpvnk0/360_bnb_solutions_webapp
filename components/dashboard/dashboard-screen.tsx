"use client";

/**
 * THE OPERATOR'S DESK — the state of the whole operation at a glance.
 *
 * Hero: pulls left against the tier limit, with a one-line summary of
 * the pipeline. Then the four figures worth knowing, every saved deal
 * against what its market actually runs, the pipeline stages, the
 * markets being watched, and recent activity.
 *
 * Everything here is this account's own data. The one thing fetched is
 * the measured summary for the markets this operator watches or holds
 * deals in — free, from rows already paid for, and scoped to them
 * rather than to the catalogue.
 *
 * A new account sees a panel that says what to do rather than four
 * zeroes and three empty cards. Zeroes are accurate and useless; the
 * question a first-time visitor has is "what now", and the screen
 * should answer that one.
 */

import * as React from "react";
import { useSession } from "@/components/providers/session-provider";
import { ActivityFeed } from "./activity-feed";
import { DashboardSkeleton } from "./dashboard-skeleton";
import { DealBoard } from "./deal-board";
import { PipelineSummary } from "./pipeline-summary";
import { PortfolioTiles, EmptyDesk, portfolioStats } from "./portfolio-tiles";
import { PullRing } from "./pull-ring";
import { useMarketStats } from "./use-market-stats";
import { WatchedMarkets } from "./watched-markets";

export function DashboardScreen() {
  const { ready, user, deals, activity, watchedMarketSlugs, pullsRemaining } =
    useSession();

  // Every market this desk has a stake in: watched, or holding a deal.
  const slugs = React.useMemo(
    () => [...new Set([...watchedMarketSlugs, ...deals.map((d) => d.marketSlug)])],
    [watchedMarketSlugs, deals]
  );
  const { ready: statsReady, stats: liveStats } = useMarketStats(slugs);

  // Measured occupancy where the store has it. Null rather than a
  // modelled stand-in: a cushion computed against an invented occupancy
  // is a number that looks like evidence and is not.
  const marketOccupancy = React.useCallback(
    (slug: string) => liveStats[slug]?.occupancy ?? null,
    [liveStats]
  );
  const stats = portfolioStats(deals, marketOccupancy);

  if (!ready || !user) {
    return <DashboardSkeleton />;
  }

  const live = deals.filter((d) => d.stage === "live").length;
  const inPlay = deals.length - live;

  return (
    <div>
      {/* Hero band — the one place hero-radial is allowed */}
      <section aria-label="Your desk" className="hero-radial border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-14 md:flex-row md:items-center md:justify-between md:px-10">
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-medium tracking-tight text-foreground md:text-4xl">
              Your desk
            </h1>
            <p className="mt-2 text-sm text-muted-foreground tabular">
              {deals.length === 0 ? (
                <>
                  {pullsRemaining} {pullsRemaining === 1 ? "analysis" : "analyses"}{" "}
                  ready when you are.
                </>
              ) : (
                <>
                  {live} {live === 1 ? "deal" : "deals"} live, {inPlay} in play,{" "}
                  {pullsRemaining}{" "}
                  {pullsRemaining === 1 ? "analysis" : "analyses"} left this
                  period.
                </>
              )}
            </p>
          </div>
          <PullRing className="self-center md:self-auto" />
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
        {deals.length === 0 ? (
          <EmptyDesk />
        ) : (
          <>
            <PortfolioTiles stats={stats} statsReady={statsReady} />
            <div className="mt-10">
              <DealBoard
                deals={deals}
                marketOccupancy={marketOccupancy}
                statsReady={statsReady}
              />
            </div>
            <div className="mt-10">
              <PipelineSummary deals={deals} />
            </div>
          </>
        )}

        <div className="mt-12 grid grid-cols-1 gap-10 pb-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start">
          <WatchedMarkets
            slugs={watchedMarketSlugs}
            liveStats={liveStats}
            statsReady={statsReady}
          />
          <ActivityFeed events={activity} />
        </div>
      </div>
    </div>
  );
}
