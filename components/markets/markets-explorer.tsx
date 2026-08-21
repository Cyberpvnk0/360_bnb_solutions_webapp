"use client";

/**
 * The /markets split explorer: filter bar pinned on top, interactive US
 * map left (60%), ranked market list right (40%). Selection syncs both
 * ways — a pin click scrolls its card into view, a card click highlights
 * (and pans to) its pin. Below lg a segmented toggle shows one pane at a
 * time.
 */

import * as React from "react";
import { ArrowDownWideNarrow, List, Map as MapIcon, SearchX } from "lucide-react";
import { revpar } from "@/lib/calc/arbitrage";
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
import { MarketCard } from "./market-card";
import { UsaMap } from "./usa-map";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Filter options                                                      */
/* ------------------------------------------------------------------ */

const OCC_OPTIONS = [
  { value: "any", label: "Any occupancy", min: 0 },
  { value: "50", label: "50%+ occupancy", min: 0.5 },
  { value: "55", label: "55%+ occupancy", min: 0.55 },
  { value: "60", label: "60%+ occupancy", min: 0.6 },
  { value: "65", label: "65%+ occupancy", min: 0.65 },
] as const;

const ADR_BANDS = [
  { value: "any", label: "Any ADR", min: undefined, max: undefined },
  { value: "under-150", label: "ADR under $150", min: undefined, max: 150 },
  { value: "150-200", label: "ADR $150–$200", min: 150, max: 200 },
  { value: "200-250", label: "ADR $200–$250", min: 200, max: 250 },
  { value: "250-up", label: "ADR $250+", min: 250, max: undefined },
] as const;

const LISTINGS_OPTIONS = [
  { value: "any", label: "Any size", min: 0 },
  { value: "500", label: "500+ listings", min: 500 },
  { value: "1000", label: "1,000+ listings", min: 1000 },
  { value: "2500", label: "2,500+ listings", min: 2500 },
  { value: "5000", label: "5,000+ listings", min: 5000 },
] as const;

type SortKey = "margin" | "adr" | "occupancy" | "revpar" | "listings";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "margin", label: "Margin of safety" },
  { value: "adr", label: "ADR" },
  { value: "occupancy", label: "Occupancy" },
  { value: "revpar", label: "RevPAR" },
  { value: "listings", label: "Listings" },
];

const SORTERS: Record<SortKey, (m: Market) => number> = {
  margin: (m) => m.occupancy - m.avgBreakeven2br,
  adr: (m) => m.adr,
  occupancy: (m) => m.occupancy,
  revpar: (m) => revpar(m.adr, m.occupancy),
  listings: (m) => m.activeListings,
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

interface MarketsExplorerProps {
  markets: Market[];
  states: string[];
}

export function MarketsExplorer({ markets, states }: MarketsExplorerProps) {
  const [stateFilter, setStateFilter] = React.useState("all");
  const [occFilter, setOccFilter] = React.useState<string>("any");
  const [adrFilter, setAdrFilter] = React.useState<string>("any");
  const [listingsFilter, setListingsFilter] = React.useState<string>("any");
  const [sort, setSort] = React.useState<SortKey>("margin");
  const [selectedSlug, setSelectedSlug] = React.useState<string | null>(null);
  const [hoverCardSlug, setHoverCardSlug] = React.useState<string | null>(null);
  const [mobilePane, setMobilePane] = React.useState<"map" | "list">("map");

  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());

  const filtered = React.useMemo(() => {
    const occ = OCC_OPTIONS.find((o) => o.value === occFilter) ?? OCC_OPTIONS[0];
    const adr = ADR_BANDS.find((o) => o.value === adrFilter) ?? ADR_BANDS[0];
    const listings =
      LISTINGS_OPTIONS.find((o) => o.value === listingsFilter) ??
      LISTINGS_OPTIONS[0];
    return markets.filter((m) => {
      if (stateFilter !== "all" && m.stateCode !== stateFilter) return false;
      if (m.occupancy < occ.min) return false;
      if (adr.min !== undefined && m.adr < adr.min) return false;
      if (adr.max !== undefined && m.adr > adr.max) return false;
      if (m.activeListings < listings.min) return false;
      return true;
    });
  }, [markets, stateFilter, occFilter, adrFilter, listingsFilter]);

  const ranked = React.useMemo(() => {
    const by = SORTERS[sort];
    return [...filtered].sort((a, b) => by(b) - by(a));
  }, [filtered, sort]);

  const hasActiveFilters =
    stateFilter !== "all" ||
    occFilter !== "any" ||
    adrFilter !== "any" ||
    listingsFilter !== "any";

  const resetFilters = () => {
    setStateFilter("all");
    setOccFilter("any");
    setAdrFilter("any");
    setListingsFilter("any");
  };

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
    <div className="flex h-[calc(100dvh-4rem)] flex-col overflow-hidden">
      {/* Filter bar — pinned above both panes. */}
      <div className="flex shrink-0 items-center gap-3 overflow-x-auto border-b border-border px-5 py-3.5">
        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger size="sm" aria-label="State" className="shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            {states.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={occFilter} onValueChange={setOccFilter}>
          <SelectTrigger size="sm" aria-label="Occupancy floor" className="shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OCC_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={adrFilter} onValueChange={setAdrFilter}>
          <SelectTrigger size="sm" aria-label="ADR range" className="shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ADR_BANDS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={listingsFilter} onValueChange={setListingsFilter}>
          <SelectTrigger size="sm" aria-label="Minimum listings" className="shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LISTINGS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            className="shrink-0 text-muted-foreground"
          >
            Reset
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
            {ranked.length} {ranked.length === 1 ? "market" : "markets"}
          </span>
        </div>
      </div>

      {/* Mobile pane toggle */}
      <div className="flex shrink-0 border-b border-border lg:hidden">
        {(
          [
            { id: "map", label: "Map", icon: MapIcon },
            { id: "list", label: "List", icon: List },
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

      {/* Panes */}
      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            "min-h-0 w-full flex-col lg:flex lg:w-[60%] lg:border-r lg:border-border",
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

        <div
          className={cn(
            "min-h-0 w-full flex-col overflow-y-auto lg:flex lg:w-[40%]",
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
            <div>
              {ranked.map((m, i) => (
                <MarketCard
                  key={m.slug}
                  ref={(el) => {
                    if (el) cardRefs.current.set(m.slug, el);
                    else cardRefs.current.delete(m.slug);
                  }}
                  market={m}
                  rank={i + 1}
                  selected={m.slug === selectedSlug}
                  onSelect={selectFromCard}
                  onHoverChange={setHoverCardSlug}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
