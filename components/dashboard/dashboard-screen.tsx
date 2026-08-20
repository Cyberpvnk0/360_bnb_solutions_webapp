"use client";

/**
 * THE OPERATOR'S DESK — the state of the whole operation at a glance.
 *
 * Hero: pulls used against the tier limit in a large gold ring, with a
 * one-line summary of the pipeline. Below: stage tiles, the watched
 * markets, and the last 30 days of activity.
 */

import { useSession } from "@/components/providers/session-provider";
import { ActivityFeed } from "./activity-feed";
import { DashboardSkeleton } from "./dashboard-skeleton";
import { PipelineSummary } from "./pipeline-summary";
import { PullRing } from "./pull-ring";
import { WatchedMarkets } from "./watched-markets";

export function DashboardScreen() {
  const { ready, user, deals, activity, watchedMarketSlugs, pullsRemaining } =
    useSession();

  if (!ready || !user) {
    return <DashboardSkeleton />;
  }

  const live = deals.filter((d) => d.stage === "live").length;
  const inPlay = deals.length - live;

  return (
    <div>
      {/* Hero band — the one place hero-radial is allowed */}
      <section aria-label="Your desk" className="hero-radial border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 md:flex-row md:items-center md:justify-between md:px-8">
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-medium tracking-tight text-foreground md:text-4xl">
              Your desk
            </h1>
            <p className="mt-2 text-sm text-muted-foreground tabular">
              {live} {live === 1 ? "deal" : "deals"} live, {inPlay} in play,{" "}
              {pullsRemaining} {pullsRemaining === 1 ? "pull" : "pulls"} left
              this period.
            </p>
          </div>
          <PullRing className="self-center md:self-auto" />
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
        <PipelineSummary deals={deals} />

        <div className="mt-10 grid grid-cols-1 gap-10 pb-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:gap-8">
          <WatchedMarkets slugs={watchedMarketSlugs} />
          <ActivityFeed events={activity} />
        </div>
      </div>
    </div>
  );
}
