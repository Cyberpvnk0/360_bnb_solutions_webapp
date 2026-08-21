"use client";

/**
 * The /markets explorer: Markets | Submarkets scope toggle, filter chips,
 * and the all-filters sheet pinned on top, ranked results on the left
 * (market cards or dense submarket rows), interactive US map on the right.
 * Selection syncs both ways. Results paginate 60 at a time; the map shows
 * the loaded page's pins. Below lg a segmented toggle shows one pane at a
 * time.
 */

import * as React from "react";
import {
  ArrowDownWideNarrow,
  LayoutGrid,
  Map as MapIcon,
  SearchX,
} from "lucide-react";
import { annualRevenueFromAdr, revpar } from "@/lib/calc/arbitrage";
import { getAllSubmarkets, getCoverageTotals } from "@/lib/data";
import { fmtNum } from "@/lib/format";
import type { Market, MarketTerrain, Submarket } from "@/lib/mock/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/primitives/empty-state";
import {
  DEFAULT_FILTERS,
  ExplorerFilterChips,
  isDefaultFilters,
  matchesFilters,
  type ExplorerFilters,
  type Sortable,
} from "./filters";
import { MarketCard } from "./market-card";
import { SubmarketRow } from "./submarket-row";
import { UsaMap, type MapPin } from "./usa-map";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 60;

type Scope = "markets" | "submarkets";

type SortKey =
  | "margin"
  | "revenue"
  | "adr"
  | "occupancy"
  | "revpar"
  | "rent"
  | "listings";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "margin", label: "Margin of safety" },
  { value: "revenue", label: "Revenue potential" },
  { value: "adr", label: "Nightly rate" },
  { value: "occupancy", label: "Occupancy" },
  { value: "revpar", label: "RevPAR" },
  { value: "rent", label: "Median rent" },
  { value: "listings", label: "Listings" },
];

const SORTERS: Record<SortKey, (r: Sortable) => number> = {
  margin: (r) => r.occupancy - r.avgBreakeven2br,
  revenue: (r) => annualRevenueFromAdr(r.adr, r.occupancy),
  adr: (r) => r.adr,
  occupancy: (r) => r.occupancy,
  revpar: (r) => revpar(r.adr, r.occupancy),
  rent: (r) => r.medianRent2br,
  listings: (r) => r.activeListings,
};

const marketHaystack = (m: Market) =>
  `${m.name} ${m.state} ${m.stateCode}`.toLowerCase();
const submarketHaystack = (s: Submarket) =>
  `${s.name} ${s.marketName} ${s.stateCode}`.toLowerCase();

/** Markets carry their own terrain. */
const marketTerrain = (m: Market): MarketTerrain => m.terrain;

interface MarketsExplorerProps {
  markets: Market[];
  states: string[];
}

export function MarketsExplorer({ markets, states }: MarketsExplorerProps) {
  const [scope, setScope] = React.useState<Scope>("markets");
  const [filters, setFilters] = React.useState<ExplorerFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = React.useState<SortKey>("margin");
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);
  const [selectedSlug, setSelectedSlug] = React.useState<string | null>(null);
  const [hoverCardSlug, setHoverCardSlug] = React.useState<string | null>(null);
  const [mobilePane, setMobilePane] = React.useState<"list" | "map">("list");
  const [submarkets, setSubmarkets] = React.useState<Submarket[] | null>(null);
  const [totals, setTotals] = React.useState<{
    markets: number;
    submarkets: number;
  } | null>(null);

  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    let cancelled = false;
    getCoverageTotals().then((t) => {
      if (!cancelled) setTotals(t);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Submarkets load once, the first time the scope flips to them.
  React.useEffect(() => {
    if (scope !== "submarkets" || submarkets !== null) return;
    let cancelled = false;
    getAllSubmarkets().then((subs) => {
      if (!cancelled) setSubmarkets(subs);
    });
    return () => {
      cancelled = true;
    };
  }, [scope, submarkets]);

  const applyFilters = React.useCallback((patch: Partial<ExplorerFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  // Submarkets don't carry a terrain — they borrow the parent market's.
  const terrainBySlug = React.useMemo(
    () => new Map<string, MarketTerrain>(markets.map((m) => [m.slug, m.terrain])),
    [markets]
  );
  const submarketTerrain = React.useCallback(
    (s: Submarket): MarketTerrain => terrainBySlug.get(s.marketSlug) ?? "metro",
    [terrainBySlug]
  );

  // Any change of lens starts the list from the top.
  const resetPaging = () => {
    setVisibleCount(PAGE_SIZE);
    listRef.current?.scrollTo({ top: 0 });
  };

  const filteredMarkets = React.useMemo(() => {
    const by = SORTERS[sort];
    return markets
      .filter((m) => matchesFilters(m, marketHaystack(m), filters, marketTerrain))
      .sort((a, b) => by(b) - by(a));
  }, [markets, filters, sort]);

  const filteredSubmarkets = React.useMemo(() => {
    if (!submarkets) return [];
    const by = SORTERS[sort];
    return submarkets
      .filter((s) =>
        matchesFilters(s, submarketHaystack(s), filters, submarketTerrain)
      )
      .sort((a, b) => by(b) - by(a));
  }, [submarkets, filters, sort, submarketTerrain]);

  /** Live count for the all-filters sheet — a draft, not yet applied. */
  const countFor = React.useCallback(
    (draft: ExplorerFilters) => {
      if (scope === "submarkets") {
        if (!submarkets) return 0;
        return submarkets.filter((s) =>
          matchesFilters(s, submarketHaystack(s), draft, submarketTerrain)
        ).length;
      }
      return markets.filter((m) =>
        matchesFilters(m, marketHaystack(m), draft, marketTerrain)
      ).length;
    },
    [scope, submarkets, markets, submarketTerrain]
  );

  const isSubScope = scope === "submarkets";
  const filteredCount = isSubScope
    ? filteredSubmarkets.length
    : filteredMarkets.length;
  const visibleMarkets = filteredMarkets.slice(0, visibleCount);
  const visibleSubmarkets = filteredSubmarkets.slice(0, visibleCount);
  const remaining = Math.max(0, filteredCount - visibleCount);

  const pins: MapPin[] = React.useMemo(
    () =>
      isSubScope
        ? visibleSubmarkets.map((s) => ({
            slug: s.id,
            name: s.name,
            stateCode: s.stateCode,
            lat: s.lat,
            lon: s.lon,
            adr: s.adr,
            occupancy: s.occupancy,
            avgBreakeven2br: s.avgBreakeven2br,
          }))
        : visibleMarkets,
    [isSubScope, visibleMarkets, visibleSubmarkets]
  );

  const hasActiveFilters = !isDefaultFilters(filters);
  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    resetPaging();
  };

  /** Pin click: select + scroll the row/card into view. */
  const selectFromMap = React.useCallback((slug: string) => {
    setSelectedSlug(slug);
    requestAnimationFrame(() => {
      cardRefs.current
        .get(slug)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, []);

  const setRef = (key: string) => (el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(key, el);
    else cardRefs.current.delete(key);
  };

  const countLabel = isSubScope
    ? `${fmtNum(filteredCount)} of ${fmtNum(totals?.submarkets ?? 0)} submarkets`
    : `${fmtNum(filteredCount)} of ${fmtNum(totals?.markets ?? markets.length)} markets`;

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col overflow-hidden contain-paint">
      {/* Scope + filter chips — white chrome band pinned above both panes. */}
      <div className="flex shrink-0 items-center gap-2.5 overflow-x-auto border-b border-border bg-surface px-5 py-3.5">
        <div
          role="tablist"
          aria-label="Browse markets or submarkets"
          className="flex shrink-0 overflow-hidden rounded-full border border-border"
        >
          {(
            [
              { id: "markets", label: "Markets" },
              { id: "submarkets", label: "Submarkets" },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={scope === s.id}
              onClick={() => {
                setScope(s.id);
                setSelectedSlug(null);
                resetPaging();
              }}
              className={cn(
                "h-8 border-r border-border px-3 text-xs font-medium transition-colors duration-150 last:border-r-0",
                scope === s.id
                  ? "bg-gold-fill/10 text-gold"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <ExplorerFilterChips
          filters={filters}
          states={states}
          countFor={countFor}
          onChange={(patch) => {
            applyFilters(patch);
            resetPaging();
          }}
        />

        {hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            className="shrink-0 text-muted-foreground"
          >
            Reset all
          </Button>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-3 pl-3">
          <Select
            value={sort}
            onValueChange={(v) => {
              setSort(v as SortKey);
              resetPaging();
            }}
          >
            <SelectTrigger size="sm" aria-label="Sort by" className="shrink-0">
              <ArrowDownWideNarrow
                aria-hidden
                className="size-3.5 text-muted-foreground"
              />
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="whitespace-nowrap text-xs text-muted-foreground tabular">
            {countLabel}
          </span>
        </div>
      </div>

      {/* Mobile pane toggle */}
      <div className="flex shrink-0 border-b border-border lg:hidden">
        {(
          [
            { id: "list", label: isSubScope ? "Submarkets" : "Markets", icon: LayoutGrid },
            { id: "map", label: "Map", icon: MapIcon },
          ] as const
        ).map((pane) => (
          <button
            key={pane.id}
            type="button"
            onClick={() => setMobilePane(pane.id)}
            aria-pressed={mobilePane === pane.id}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2 text-sm font-medium transition-colors duration-150",
              mobilePane === pane.id
                ? "border-gold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <pane.icon aria-hidden className="size-3.5" />
            {pane.label}
          </button>
        ))}
      </div>

      {/* Panes: results left, map right. */}
      <div className="flex min-h-0 flex-1">
        <div
          ref={listRef}
          className={cn(
            "min-h-0 w-full flex-col overflow-y-auto lg:flex lg:flex-1",
            mobilePane === "list" ? "flex" : "hidden lg:flex"
          )}
        >
          {isSubScope && submarkets === null ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-[74px] w-full" />
              ))}
            </div>
          ) : filteredCount === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={SearchX}
                title={isSubScope ? "No submarkets match" : "No markets match"}
                description="These filters rule out everything we track. Loosen one and the list comes back."
                action={
                  <Button variant="outline" onClick={resetFilters}>
                    Reset filters
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              {isSubScope ? (
                <div className="flex flex-col gap-3 p-5">
                  {visibleSubmarkets.map((s) => (
                    <SubmarketRow
                      key={s.id}
                      ref={setRef(s.id)}
                      submarket={s}
                      selected={s.id === selectedSlug}
                      onHoverChange={setHoverCardSlug}
                    />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-5 p-5 xl:grid-cols-2">
                  {visibleMarkets.map((m) => (
                    <MarketCard
                      key={m.slug}
                      ref={setRef(m.slug)}
                      market={m}
                      selected={m.slug === selectedSlug}
                      onHoverChange={setHoverCardSlug}
                    />
                  ))}
                </div>
              )}
              {remaining > 0 ? (
                <div className="flex justify-center px-5 pb-8">
                  <Button
                    variant="outline"
                    onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  >
                    Show {Math.min(PAGE_SIZE, remaining)} more ·{" "}
                    {fmtNum(remaining)} remaining
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div
          className={cn(
            "min-h-0 w-full flex-col lg:flex lg:w-[42%] lg:shrink-0 lg:border-l lg:border-border",
            mobilePane === "map" ? "flex" : "hidden"
          )}
        >
          <UsaMap
            markets={pins}
            selectedSlug={selectedSlug}
            highlightSlug={hoverCardSlug}
            onSelect={selectFromMap}
            className="h-full"
          />
        </div>
      </div>
    </div>
  );
}
