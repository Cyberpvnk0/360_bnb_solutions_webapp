"use client";

/**
 * The /deals Deal Finder: a Zillow-familiar, rentals-only nationwide
 * browser. Filter chips pinned on top, the street map on the LEFT
 * (Zillow's desktop arrangement), the listing card grid on the right.
 * Hover syncs card and price pill in both directions; clicking a pill
 * scrolls its card into view. Results paginate 24 at a time and the map
 * pins only the loaded page. Below lg a segmented toggle shows one pane
 * at a time.
 */

import * as React from "react";
import { LayoutGrid, Map as MapIcon, ArrowDownWideNarrow, SearchX } from "lucide-react";
import { getLiveRentals, getRentalTotals } from "@/lib/data";
import { fmtNum } from "@/lib/format";
import { estimateCushionPts } from "@/lib/mock/rentals";
import type { Market, RentalListing } from "@/lib/mock/types";
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
  DealFilterChips,
  DEFAULT_DEAL_FILTERS,
  isDefaultDealFilters,
  normalizeKeyword,
  TYPE_LABEL,
  type DealFilters,
} from "./deal-filters";
import { ListingCard } from "./listing-card";
import { RentalsMap } from "./rentals-map";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 24;

type SortKey = "spread" | "newest" | "rent-asc" | "rent-desc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "spread", label: "Best spread" },
  { value: "newest", label: "Newest" },
  { value: "rent-asc", label: "Rent: low to high" },
  { value: "rent-desc", label: "Rent: high to low" },
];

/** A listing joined with its market context, computed once. */
interface Row {
  listing: RentalListing;
  /** Whole points, from lib/mock/rentals (which uses lib/calc). */
  cushionPts: number;
  /** Lowercased market-name/state haystack for the Location search. */
  haystack: string;
  /** Punctuation-blind haystack for the Keywords filter: features,
   *  address, market, and home type, all through normalizeKeyword. */
  keywordHaystack: string;
}

const SORTERS: Record<SortKey, (a: Row, b: Row) => number> = {
  spread: (a, b) => b.cushionPts - a.cushionPts,
  newest: (a, b) => a.listing.daysOnMarket - b.listing.daysOnMarket,
  "rent-asc": (a, b) => a.listing.rentMonthly - b.listing.rentMonthly,
  "rent-desc": (a, b) => b.listing.rentMonthly - a.listing.rentMonthly,
};

function matchesFilters(row: Row, f: DealFilters): boolean {
  const l = row.listing;
  const q = f.query.toLowerCase();
  if (q && !row.haystack.includes(q)) return false;
  if (f.states.length > 0 && !f.states.includes(l.stateCode)) return false;
  // Slider bounds at their extremes mean "no bound" — the default view
  // must show every listing, including any outside the slider's track.
  if (f.rentMin > DEFAULT_DEAL_FILTERS.rentMin && l.rentMonthly < f.rentMin) {
    return false;
  }
  if (f.rentMax < DEFAULT_DEAL_FILTERS.rentMax && l.rentMonthly > f.rentMax) {
    return false;
  }
  if (f.bedsMin > 0 && l.bedrooms < f.bedsMin) return false;
  if (f.bathsMin > 0 && l.bathrooms < f.bathsMin) return false;
  if (!f.types.includes(l.propertyType)) return false;
  if (f.furnishedOnly && !l.features.includes("Furnished")) return false;
  // Every keyword must land somewhere in the listing (Zillow semantics).
  for (const kw of f.keywords) {
    if (!row.keywordHaystack.includes(normalizeKeyword(kw))) return false;
  }
  return true;
}

interface DealsExplorerProps {
  rentals: RentalListing[];
  markets: Market[];
  states: string[];
}

export function DealsExplorer({ rentals, markets, states }: DealsExplorerProps) {
  const [filters, setFilters] = React.useState<DealFilters>(DEFAULT_DEAL_FILTERS);
  const [sort, setSort] = React.useState<SortKey>("spread");
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [mobilePane, setMobilePane] = React.useState<"list" | "map">("list");
  const [totals, setTotals] = React.useState<{
    rentals: number;
    markets: number;
  } | null>(null);

  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    let cancelled = false;
    getRentalTotals().then((t) => {
      if (!cancelled) setTotals(t);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live mode: when the Location search resolves to exactly one market,
  // swap that market's preview rows for today's actual inventory.
  const liveTarget = React.useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    if (!q) return null;
    const hits = markets.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        `${m.name}, ${m.stateCode}`.toLowerCase().includes(q)
    );
    return hits.length === 1 ? hits[0] : null;
  }, [filters.query, markets]);

  const [live, setLive] = React.useState<{
    slug: string;
    asOf?: string;
    listings: RentalListing[];
  } | null>(null);
  // The last market slug the feed answered for (live or fallback) —
  // "checking" is derived, so no synchronous setState in the effect.
  const [liveChecked, setLiveChecked] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!liveTarget) return;
    const slug = liveTarget.slug;
    let cancelled = false;
    getLiveRentals(slug).then((result) => {
      if (cancelled) return;
      setLive(
        result.live
          ? { slug, asOf: result.asOf, listings: result.listings }
          : null
      );
      setLiveChecked(slug);
    });
    return () => {
      cancelled = true;
    };
  }, [liveTarget]);

  const liveActive = Boolean(
    liveTarget && live && live.slug === liveTarget.slug
  );
  const liveChecking = Boolean(
    liveTarget && liveChecked !== liveTarget.slug
  );

  // Join listings with their market once — cushion comes through
  // lib/mock/rentals (lib/calc underneath), never an inline formula.
  const rows = React.useMemo<Row[]>(() => {
    const bySlug = new Map(markets.map((m) => [m.slug, m]));
    // In live mode the target market's rows come from the feed; its
    // preview rows drop out so real and seeded inventory never mix.
    const source = liveActive
      ? [
          ...live!.listings,
          ...rentals.filter((l) => l.marketSlug !== live!.slug),
        ]
      : rentals;
    return source.flatMap((listing) => {
      const market = bySlug.get(listing.marketSlug);
      if (!market) return [];
      return [
        {
          listing,
          cushionPts: estimateCushionPts(listing, market),
          haystack:
            `${market.name} ${market.state} ${market.stateCode}`.toLowerCase(),
          keywordHaystack: normalizeKeyword(
            [
              listing.address,
              market.name,
              market.state,
              market.stateCode,
              TYPE_LABEL[listing.propertyType],
              ...listing.features,
            ].join(" ")
          ),
        },
      ];
    });
  }, [rentals, markets, liveActive, live]);

  const applyFilters = React.useCallback((patch: Partial<DealFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  // Any change of lens starts the list from the top.
  const resetPaging = () => {
    setVisibleCount(PAGE_SIZE);
    listRef.current?.scrollTo({ top: 0 });
  };

  const filtered = React.useMemo(() => {
    const by = SORTERS[sort];
    return rows.filter((r) => matchesFilters(r, filters)).sort(by);
  }, [rows, filters, sort]);

  const visible = React.useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount]
  );
  const remaining = Math.max(0, filtered.length - visibleCount);
  const visibleListings = React.useMemo(
    () => visible.map((r) => r.listing),
    [visible]
  );

  const hasActiveFilters = !isDefaultDealFilters(filters);
  const resetFilters = () => {
    setFilters(DEFAULT_DEAL_FILTERS);
    resetPaging();
  };

  /** Pill click: select + scroll the card into view. */
  const selectFromMap = React.useCallback((id: string) => {
    setSelectedId(id);
    setMobilePane("list");
    requestAnimationFrame(() => {
      cardRefs.current
        .get(id)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, []);

  const setRef = (key: string) => (el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(key, el);
    else cardRefs.current.delete(key);
  };

  const countLabel = liveActive
    ? `${fmtNum(filtered.length)} live rentals in ${liveTarget!.name}`
    : `${fmtNum(filtered.length)} of ${fmtNum(
        totals?.rentals ?? rentals.length
      )} rentals`;

  const liveAsOfLabel =
    liveActive && live?.asOf
      ? new Date(live.asOf).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })
      : null;

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col overflow-hidden contain-paint">
      {/* Filter chips — white chrome band pinned above both panes. */}
      <div className="flex shrink-0 items-center gap-2.5 overflow-x-auto border-b border-border bg-surface px-5 py-3.5">
        <DealFilterChips
          filters={filters}
          states={states}
          onChange={(patch) => {
            applyFilters(patch);
            setSelectedId(null);
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

        {/* Provenance — students always know which inventory they see. */}
        {liveActive ? (
          <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-gold/50 bg-gold-fill/10 px-3.5 text-xs font-medium text-gold">
            <span aria-hidden className="size-1.5 rounded-full bg-gold-fill" />
            Live · {liveTarget!.name}
            {liveAsOfLabel ? (
              <span className="font-normal text-muted-foreground">
                as of {liveAsOfLabel}
              </span>
            ) : null}
          </span>
        ) : liveTarget && liveChecking ? (
          <span className="flex h-8 shrink-0 items-center rounded-full border border-border px-3.5 text-xs text-muted-foreground">
            Checking live listings…
          </span>
        ) : liveTarget ? (
          <span className="flex h-8 shrink-0 items-center rounded-full border border-border px-3.5 text-xs text-muted-foreground">
            Preview inventory
          </span>
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
            { id: "list", label: "Rentals", icon: LayoutGrid },
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

      {/* Panes: map left (Zillow's desktop arrangement), listings right. */}
      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            "min-h-0 w-full flex-col lg:flex lg:w-[55%] lg:shrink-0 lg:border-r lg:border-border",
            mobilePane === "map" ? "flex" : "hidden"
          )}
        >
          <RentalsMap
            listings={visibleListings}
            hoveredId={hoveredId}
            selectedId={selectedId}
            onHover={setHoveredId}
            onSelect={selectFromMap}
            className="min-h-0 flex-1"
          />
        </div>

        <div
          ref={listRef}
          className={cn(
            "min-h-0 w-full flex-col overflow-y-auto lg:flex lg:flex-1",
            mobilePane === "list" ? "flex" : "hidden lg:flex"
          )}
        >
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={SearchX}
                title="No rentals match"
                description="These filters rule out every listing we track. Loosen one and the grid comes back."
                action={
                  <Button variant="outline" onClick={resetFilters}>
                    Reset filters
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-5 p-5 xl:grid-cols-2">
                {visible.map((r) => (
                  <ListingCard
                    key={r.listing.id}
                    ref={setRef(r.listing.id)}
                    listing={r.listing}
                    cushionPts={r.cushionPts}
                    selected={r.listing.id === selectedId}
                    hovered={r.listing.id === hoveredId}
                    onHoverChange={setHoveredId}
                  />
                ))}
              </div>
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
      </div>
    </div>
  );
}
