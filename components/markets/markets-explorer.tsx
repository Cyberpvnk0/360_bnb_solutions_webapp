"use client";

/**
 * The /markets explorer: filter chips pinned on top, market card grid on
 * the left, interactive US map on the right. Selection syncs both ways —
 * a pin click scrolls its card into view, a card click highlights (and
 * pans to) its pin. Below lg a segmented toggle shows one pane at a time.
 */

import * as React from "react";
import { ArrowDownWideNarrow, LayoutGrid, Map as MapIcon, SearchX } from "lucide-react";
import { annualRevenueFromAdr, revpar } from "@/lib/calc/arbitrage";
import type { Market } from "@/lib/mock/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/primitives/empty-state";
import {
  DEFAULT_FILTERS,
  ExplorerFilterChips,
  isDefaultFilters,
  type ExplorerFilters,
} from "./filters";
import { MarketCard } from "./market-card";
import { UsaMap } from "./usa-map";
import { cn } from "@/lib/utils";

type SortKey = "margin" | "revenue" | "adr" | "occupancy" | "revpar" | "listings";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "margin", label: "Margin of safety" },
  { value: "revenue", label: "Revenue potential" },
  { value: "adr", label: "Nightly rate" },
  { value: "occupancy", label: "Occupancy" },
  { value: "revpar", label: "RevPAR" },
  { value: "listings", label: "Listings" },
];

const SORTERS: Record<SortKey, (m: Market) => number> = {
  margin: (m) => m.occupancy - m.avgBreakeven2br,
  revenue: (m) => annualRevenueFromAdr(m.adr, m.occupancy),
  adr: (m) => m.adr,
  occupancy: (m) => m.occupancy,
  revpar: (m) => revpar(m.adr, m.occupancy),
  listings: (m) => m.activeListings,
};

interface MarketsExplorerProps {
  markets: Market[];
  states: string[];
}

export function MarketsExplorer({ markets, states }: MarketsExplorerProps) {
  const [filters, setFilters] = React.useState<ExplorerFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = React.useState<SortKey>("margin");
  const [selectedSlug, setSelectedSlug] = React.useState<string | null>(null);
  const [hoverCardSlug, setHoverCardSlug] = React.useState<string | null>(null);
  const [mobilePane, setMobilePane] = React.useState<"list" | "map">("list");

  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());

  const applyFilters = React.useCallback((patch: Partial<ExplorerFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const filtered = React.useMemo(() => {
    const q = filters.query.toLowerCase();
    return markets.filter((m) => {
      if (
        q &&
        !m.name.toLowerCase().includes(q) &&
        !m.state.toLowerCase().includes(q) &&
        !m.stateCode.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (filters.states.length > 0 && !filters.states.includes(m.stateCode)) {
        return false;
      }
      if (m.occupancy < filters.occMin || m.occupancy > filters.occMax) {
        return false;
      }
      if (m.adr < filters.adrMin) return false;
      if (filters.adrMax < DEFAULT_FILTERS.adrMax && m.adr > filters.adrMax) {
        return false;
      }
      if (m.activeListings < filters.listingsMin) return false;
      if (
        filters.listingsMax < DEFAULT_FILTERS.listingsMax &&
        m.activeListings > filters.listingsMax
      ) {
        return false;
      }
      const marginPts = (m.occupancy - m.avgBreakeven2br) * 100;
      if (marginPts < filters.marginMin) return false;
      return true;
    });
  }, [markets, filters]);

  const ranked = React.useMemo(() => {
    const by = SORTERS[sort];
    return [...filtered].sort((a, b) => by(b) - by(a));
  }, [filtered, sort]);

  const hasActiveFilters = !isDefaultFilters(filters);
  const resetFilters = () => setFilters(DEFAULT_FILTERS);

  /** Pin click: select + scroll the card into view. */
  const selectFromMap = React.useCallback((slug: string) => {
    setSelectedSlug(slug);
    requestAnimationFrame(() => {
      cardRefs.current
        .get(slug)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, []);

  const selectFromCard = React.useCallback((slug: string) => {
    setSelectedSlug((prev) => (prev === slug ? null : slug));
  }, []);

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col overflow-hidden contain-paint">
      {/* Filter chips — pinned above both panes. */}
      <div className="flex shrink-0 items-center gap-2.5 overflow-x-auto border-b border-border px-5 py-3.5">
        <ExplorerFilterChips
          filters={filters}
          states={states}
          onChange={applyFilters}
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
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger size="sm" aria-label="Sort markets by" className="shrink-0">
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
            {ranked.length} of {markets.length} markets
          </span>
        </div>
      </div>

      {/* Mobile pane toggle */}
      <div className="flex shrink-0 border-b border-border lg:hidden">
        {(
          [
            { id: "list", label: "Markets", icon: LayoutGrid },
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

      {/* Panes: card grid left, map right. */}
      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            "min-h-0 w-full flex-col overflow-y-auto lg:flex lg:flex-1",
            mobilePane === "list" ? "flex" : "hidden lg:flex"
          )}
        >
          {ranked.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={SearchX}
                title="No markets match"
                description="These filters rule out every market we track. Loosen one and the list comes back."
                action={
                  <Button variant="outline" onClick={resetFilters}>
                    Reset filters
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 p-5 xl:grid-cols-2">
              {ranked.map((m) => (
                <MarketCard
                  key={m.slug}
                  ref={(el) => {
                    if (el) cardRefs.current.set(m.slug, el);
                    else cardRefs.current.delete(m.slug);
                  }}
                  market={m}
                  selected={m.slug === selectedSlug}
                  onSelect={selectFromCard}
                  onHoverChange={setHoverCardSlug}
                />
              ))}
            </div>
          )}
        </div>

        <div
          className={cn(
            "min-h-0 w-full flex-col lg:flex lg:w-[42%] lg:shrink-0 lg:border-l lg:border-border",
            mobilePane === "map" ? "flex" : "hidden"
          )}
        >
          <UsaMap
            markets={ranked}
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
