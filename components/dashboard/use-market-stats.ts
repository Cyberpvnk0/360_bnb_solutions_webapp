"use client";

/**
 * Measured figures for the markets this operator watches or holds
 * deals in.
 *
 * Client-side on purpose. Which markets matter is a fact about the
 * signed-in account, and the account's rows arrive after mount — so a
 * server render cannot know the slugs, and reading the whole store to
 * find three of them would make every desk pay for the catalogue.
 *
 * Free either way: the route reads rows already paid for and calls no
 * vendor. `ready` exists so a desk can hold a skeleton rather than
 * flash modelled numbers and then replace them with measured ones,
 * which reads as the figures having changed.
 */

import * as React from "react";
import type { StoredMarketStats } from "@/lib/db/market-store";

export interface MarketStatsRow extends Omit<StoredMarketStats, "monthly"> {
  asOf: string | null;
}

export type MarketStatsBySlug = Record<string, MarketStatsRow>;

const EMPTY: MarketStatsBySlug = {};

export function useMarketStats(slugs: string[]): {
  ready: boolean;
  stats: MarketStatsBySlug;
} {
  // The identity of the list, not the array — a new array with the same
  // slugs every render would refetch forever.
  const key = React.useMemo(
    () => [...new Set(slugs)].sort().join(","),
    [slugs]
  );

  const [state, setState] = React.useState<{
    key: string;
    stats: MarketStatsBySlug;
  } | null>(null);

  React.useEffect(() => {
    if (key === "") return;
    let cancelled = false;
    fetch(`/api/markets/stats?slugs=${encodeURIComponent(key)}`)
      .then((res) => (res.ok ? res.json() : { stats: {} }))
      .catch(() => ({ stats: {} }))
      .then((body: { stats?: MarketStatsBySlug }) => {
        if (cancelled) return;
        setState({ key, stats: body.stats ?? {} });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  // Nothing to ask about is an answer, not a wait.
  if (key === "") return { ready: true, stats: EMPTY };
  // A stale answer belongs to a different set of markets; treat it as
  // no answer rather than showing one market's figures under another's.
  if (state?.key !== key) return { ready: false, stats: EMPTY };
  return { ready: true, stats: state.stats };
}
