"use client";

/**
 * The /deals Deal Finder: a Zillow-familiar, rentals-only browser.
 *
 * Search-first, like every property portal: nothing is listed until a
 * market or ZIP is named, so the page opens on an invitation rather than
 * a random slice of 13,000 rentals. Filter chips pin on top, the street
 * map sits LEFT (Zillow's desktop arrangement), the card grid right.
 * Hover syncs card and price pill both ways; clicking a pill opens the
 * listing. Results paginate 24 at a time. Below lg a segmented toggle
 * shows one pane at a time.
 */

import * as React from "react";
import {
  ArrowDownWideNarrow,
  Bookmark,
  Info,
  LayoutGrid,
  Loader2,
  Map as MapIcon,
  Search,
  SearchX,
} from "lucide-react";
import {
  getLiveRentals,
  getLiveRentalsByZip,
  type LiveFailureReason,
} from "@/lib/data";
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
import { useSession } from "@/components/providers/session-provider";
import {
  enrichFailureLabel,
  enrichListings,
  type EnrichFailureReason,
} from "@/lib/data/enrich";
import {
  DealFilterChips,
  DEFAULT_DEAL_FILTERS,
  isDefaultDealFilters,
  marketMatchesQuery,
  normalizeKeyword,
  TYPE_LABEL,
  type DealFilters,
} from "./deal-filters";
import { MarketSearchBox } from "./market-search";
import { ListingDetailDialog } from "./listing-detail-dialog";
import { ListingCard } from "./listing-card";
import { RentalsMap, type MapFocus } from "./rentals-map";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 24;

/** One-tap starts on the opening screen — the markets a coaching
 *  student is most likely hunting first. */
const STARTER_MARKETS = [
  "jacksonville",
  "tampa",
  "austin",
  "nashville",
  "phoenix",
  "charlotte",
];

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
  /** Punctuation-blind haystack for the Keywords filter: the listing's
   *  DESCRIPTION plus its features, address, market and home type — the
   *  same surface Zillow's keyword search reads. */
  keywordHaystack: string;
}

const SORTERS: Record<SortKey, (a: Row, b: Row) => number> = {
  spread: (a, b) => b.cushionPts - a.cushionPts,
  // A listing whose age we don't know sorts last, never as the freshest.
  newest: (a, b) =>
    (a.listing.daysOnMarket ?? Number.POSITIVE_INFINITY) -
    (b.listing.daysOnMarket ?? Number.POSITIVE_INFINITY),
  "rent-asc": (a, b) => a.listing.rentMonthly - b.listing.rentMonthly,
  "rent-desc": (a, b) => b.listing.rentMonthly - a.listing.rentMonthly,
};

function matchesFilters(row: Row, f: DealFilters): boolean {
  const l = row.listing;
  // Token matching survives real typing: "jacksonville florida",
  // "Jacksonville, FL", and "jacksonville" all resolve the same market.
  if (f.query && !marketMatchesQuery(row.haystack, f.query)) return false;
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
  // A listing whose amenities are unknown is never excluded by a feature
  // filter — absence of data is not evidence of absence.
  if (
    f.furnishedOnly &&
    l.featuresKnown !== false &&
    !l.features.includes("Furnished")
  ) {
    return false;
  }
  // Every keyword must land somewhere in the listing (Zillow semantics).
  for (const kw of f.keywords) {
    if (!row.keywordHaystack.includes(normalizeKeyword(kw))) return false;
  }
  return true;
}

/** Plain-language explanation of a live-feed miss — a wrong key must
 *  never read as "no listings here". */
function liveFailureLabel(reason: LiveFailureReason | null | undefined): string {
  switch (reason) {
    case "no-key":
      return "Live feed not configured";
    case "auth":
      return "Live feed key rejected";
    case "quota":
      return "Live feed quota reached";
    case "daily-cap":
      return "Daily live-search limit reached";
    case "http":
    case "network":
      return "Live feed unreachable";
    default:
      return "Preview inventory";
  }
}

interface DealsExplorerProps {
  markets: Market[];
  states: string[];
  /** Coverage figures for the opening invitation. */
  totals: { rentals: number; markets: number };
}

export function DealsExplorer({ markets, states, totals }: DealsExplorerProps) {
  const [filters, setFilters] = React.useState<DealFilters>(DEFAULT_DEAL_FILTERS);
  const [sort, setSort] = React.useState<SortKey>("spread");
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [mobilePane, setMobilePane] = React.useState<"list" | "map">("list");
  const [detailId, setDetailId] = React.useState<string | null>(null);
  /** null = every listing; a list id = only that list's saved rentals. */
  const [listFilter, setListFilter] = React.useState<string | null>(null);
  const { lists } = useSession();
  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());
  const listRef = React.useRef<HTMLDivElement>(null);

  // ZIP mode: a 5-digit search hits the live feed directly (ZIP search
  // is live-only — the preview world has no honest ZIP inventory).
  const [zip, setZip] = React.useState<string | null>(null);
  const [zipResult, setZipResult] = React.useState<{
    zip: string;
    live: boolean;
    asOf?: string;
    reason?: LiveFailureReason;
    center?: { lat: number; lon: number } | null;
    remaining?: number;
    listings: RentalListing[];
  } | null>(null);

  React.useEffect(() => {
    if (!zip) return;
    let cancelled = false;
    getLiveRentalsByZip(zip).then((result) => {
      if (cancelled) return;
      setZipResult({
        zip,
        live: result.live,
        asOf: result.asOf,
        reason: result.reason,
        center: result.center,
        remaining: result.remaining,
        listings: result.listings,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [zip]);

  const zipActive = Boolean(zip && zipResult?.zip === zip && zipResult.live);
  const zipChecking = Boolean(zip && zipResult?.zip !== zip);
  const zipFailed = Boolean(
    zip && zipResult?.zip === zip && !zipResult.live
  );

  // Live mode: when the Location search resolves to exactly one market,
  // swap that market's preview rows for today's actual inventory.
  const liveTarget = React.useMemo(() => {
    if (zip) return null;
    const q = filters.query.trim();
    if (!q) return null;
    const hits = markets.filter((m) =>
      marketMatchesQuery(`${m.name} ${m.state} ${m.stateCode}`.toLowerCase(), q)
    );
    return hits.length === 1 ? hits[0] : null;
  }, [filters.query, markets, zip]);

  const [live, setLive] = React.useState<{
    slug: string;
    /** False when these are the preview rows the feed fell back to. */
    isLive: boolean;
    asOf?: string;
    remaining?: number;
    listings: RentalListing[];
  } | null>(null);
  const [liveReason, setLiveReason] = React.useState<LiveFailureReason | null>(
    null
  );
  // The last market slug the feed answered for (live or fallback) —
  // "checking" is derived, so no synchronous setState in the effect.
  const [liveChecked, setLiveChecked] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!liveTarget) return;
    const slug = liveTarget.slug;
    let cancelled = false;
    getLiveRentals(slug).then((result) => {
      if (cancelled) return;
      // Keep the rows either way: live inventory when the feed answers,
      // the market's preview set when it can't.
      setLive({
        slug,
        isLive: result.live,
        asOf: result.asOf,
        remaining: result.remaining,
        listings: result.listings,
      });
      setLiveReason(result.live ? null : (result.reason ?? "network"));
      setLiveChecked(slug);
    });
    return () => {
      cancelled = true;
    };
  }, [liveTarget]);

  /* ---------------------------------------------------------------- */
  /* Amenity enrichment                                                 */
  /*                                                                    */
  /* Live feeds carry no amenity data, so the flags behind Furnished are
     read from each listing's own page. That costs money per property,
     so it happens on demand and narrowly: only when a student actually
     asks for a feature, only for rows on screen, and never twice for
     the same row. Rows that can't be read stay unknown — the filter
     already excludes unknown rather than calling it unfurnished.       */
  /* ---------------------------------------------------------------- */

  const [enriched, setEnriched] = React.useState<
    Record<string, { features: string[]; featuresKnown: boolean }>
  >({});
  /** Ids we now have an answer for, hit or miss. Set only in the async
   *  callback, so "checking" stays derived — no sync setState in an
   *  effect, no ref read during render. */
  const [answered, setAnswered] = React.useState<Record<string, true>>({});
  const [enrichReason, setEnrichReason] =
    React.useState<EnrichFailureReason | null>(null);
  const requestedRef = React.useRef(new Set<string>());
  /** Whether this page is gone — see the note in the enrichment effect.
   *  Reset on mount as well as set on teardown: StrictMode mounts,
   *  unmounts and remounts in development, and a flag that only ever
   *  went true would leave every later wave bailing out. */
  const unmountedRef = React.useRef(false);
  React.useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const marketRows =
    liveTarget && live?.slug === liveTarget.slug ? live.listings : null;
  const liveActive = Boolean(
    liveTarget && live?.slug === liveTarget.slug && live.isLive
  );
  const liveChecking = Boolean(
    liveTarget && liveChecked !== liveTarget.slug
  );

  // Join listings with their market once — cushion comes through
  // lib/mock/rentals (lib/calc underneath), never an inline formula.
  const rows = React.useMemo<Row[]>(() => {
    const bySlug = new Map(markets.map((m) => [m.slug, m]));
    // Search-first: a ZIP is answered by the feed alone, a market by its
    // live rows (or its preview set when the feed can't answer), a saved
    // list by what's in it. With no search and no list, nothing shows.
    const source = zip
      ? zipActive
        ? zipResult!.listings
        : []
      : (marketRows ??
        (listFilter
          ? (lists.find((l) => l.id === listFilter)?.listings ?? [])
          : []));
    return source.flatMap((raw) => {
      const market = bySlug.get(raw.marketSlug);
      if (!market) return [];
      // A row we've read the page for carries real flags from here on.
      const facts = enriched[raw.id];
      const listing = facts
        ? { ...raw, features: facts.features, featuresKnown: true }
        : raw;
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
              listing.description ?? "",
            ].join(" ")
          ),
        },
      ];
    });
  }, [markets, marketRows, zip, zipActive, zipResult, listFilter, lists, enriched]);

  const applyFilters = React.useCallback((patch: Partial<DealFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  // Any change of lens starts the list from the top.
  const resetPaging = () => {
    setVisibleCount(PAGE_SIZE);
    listRef.current?.scrollTo({ top: 0 });
  };

  // Live feeds ship no amenity data, but an unread live row is a
  // question we can answer rather than a dead end — so a feature filter
  // stays usable while enrichment is available, and only greys out once
  // the lookup itself has told us it can't help.
  const readableRows = rows.some(
    (r) => r.listing.featuresKnown !== true && r.listing.id.startsWith("live--")
  );
  const featuresKnown =
    rows.length === 0 ||
    rows.some((r) => r.listing.featuresKnown !== false) ||
    (readableRows && enrichReason === null);

  const filtered = React.useMemo(() => {
    const by = SORTERS[sort];
    return rows
      .filter((r) => matchesFilters(r, filters))
      .filter((r) => {
        if (!listFilter) return true;
        const list = lists.find((l) => l.id === listFilter);
        return Boolean(list?.listings.some((x) => x.id === r.listing.id));
      })
      .sort(by);
  }, [rows, filters, sort, listFilter, lists]);

  const visible = React.useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount]
  );
  const remaining = Math.max(0, filtered.length - visibleCount);

  /** One browsing session must not be able to spend the whole day's
   *  amenity budget chasing a single filter through a long list. */
  const SESSION_ENRICH_LIMIT = 96;
  /** Properties per request — one concurrency wave, matching the
   *  server's own batch ceiling. */
  const ENRICH_BATCH = 8;

  // Reading a listing page costs money, so it happens only once a
  // student has actually asked a question that needs the answer.
  const wantsFeatures =
    filters.furnishedOnly || filters.keywords.length > 0;

  const pending = React.useMemo(() => {
    if (!wantsFeatures || enrichReason !== null) return [];
    return visible
      .map((r) => r.listing)
      .filter((l) => l.featuresKnown !== true && l.id.startsWith("live--"));
  }, [wantsFeatures, visible, enrichReason]);

  /** Derived, never assigned in an effect: a row is "checking" until it
   *  has an answer, and a miss counts as an answer. */
  const enriching = pending.some((l) => !answered[l.id]);

  React.useEffect(() => {
    const allowance = SESSION_ENRICH_LIMIT - requestedRef.current.size;
    if (allowance <= 0) return;
    const todo = pending
      .filter((l) => !requestedRef.current.has(l.id))
      .slice(0, allowance);
    if (todo.length === 0) return;
    for (const l of todo) requestedRef.current.add(l.id);

    // Reading a protected listing page takes seconds, so a whole page of
    // cards is several waves of work. Send it a wave at a time and merge
    // each answer as it lands: cards fill in progressively instead of
    // the list sitting frozen until the last one returns, and no single
    // request ever approaches the function timeout.
    //
    // Deliberately NOT cancelled when this effect re-runs. Merging a
    // wave changes `pending`, which restarts the effect — so a
    // per-effect cancel would discard the next wave's answer while its
    // ids stayed marked as requested, paying the vendor and binning the
    // result. A fact about a listing is valid whenever it arrives; the
    // only thing worth stopping for is an unmounted page.
    void (async () => {
      for (let i = 0; i < todo.length; i += ENRICH_BATCH) {
        if (unmountedRef.current) return;
        const wave = todo.slice(i, i + ENRICH_BATCH);
        const result = await enrichListings(wave);
        if (unmountedRef.current) return;
        // Every id gets marked answered, hit or miss — otherwise a row
        // we couldn't read would spin forever.
        setAnswered((prev) => {
          const next = { ...prev };
          for (const l of wave) next[l.id] = true;
          return next;
        });
        if (result.ok) {
          setEnriched((prev) => ({ ...prev, ...result.facts }));
        } else {
          // A configuration or budget failure applies to every wave, so
          // stop rather than burning the rest of the page on it.
          setEnrichReason(result.reason ?? "network");
          setAnswered((prev) => {
            const next = { ...prev };
            for (const l of todo) next[l.id] = true;
            return next;
          });
          return;
        }
      }
    })();
  }, [pending]);
  // Targeted searches (a market or a ZIP) pin the ENTIRE result set —
  // the whole city, not just the page the list is showing — and frame
  // the searched area so a metro reads as a metro. Nationwide browsing
  // spreads a wide sample so the country never looks empty.
  const targeted = Boolean(zip || liveTarget);
  const MAP_PIN_CAP = targeted ? 400 : 300;
  const mapListings = React.useMemo(
    () => filtered.slice(0, MAP_PIN_CAP).map((r) => r.listing),
    [filtered, MAP_PIN_CAP]
  );

  const mapFocus = React.useMemo<MapFocus | null>(() => {
    if (zipActive && zipResult?.center) {
      return {
        key: `zip-${zip}`,
        lat: zipResult.center.lat,
        lon: zipResult.center.lon,
        radiusMiles: 6,
      };
    }
    // A market search frames its whole 30-mile metro whether the rows
    // came from the feed or the preview set.
    if (liveTarget) {
      return {
        key: `market-${liveTarget.slug}`,
        lat: liveTarget.lat,
        lon: liveTarget.lon,
        radiusMiles: 30,
      };
    }
    return null;
  }, [zipActive, zipResult, zip, liveTarget]);

  const hasActiveFilters =
    !isDefaultDealFilters(filters) || zip !== null || listFilter !== null;
  const resetFilters = () => {
    setFilters(DEFAULT_DEAL_FILTERS);
    setZip(null);
    setZipResult(null);
    setListFilter(null);
    resetPaging();
  };

  const applyLocationQuery = (query: string) => {
    setZip(null);
    applyFilters({ query });
    setSelectedId(null);
    resetPaging();
  };

  const applyZipSearch = (nextZip: string) => {
    applyFilters({ query: "" });
    setZip(nextZip);
    setSelectedId(null);
    resetPaging();
  };

  /** Pill click: select the listing, open its panel, and line the card
   *  up behind it so closing the panel lands you in the right place. */
  const selectFromMap = React.useCallback((id: string) => {
    setSelectedId(id);
    setDetailId(id);
    requestAnimationFrame(() => {
      cardRefs.current
        .get(id)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, []);

  const openDetail = React.useCallback((id: string) => {
    setSelectedId(id);
    setDetailId(id);
  }, []);

  const detailRow = React.useMemo(
    () => (detailId ? rows.find((r) => r.listing.id === detailId) : undefined),
    [detailId, rows]
  );
  const detailMarket = React.useMemo(
    () =>
      detailRow
        ? (markets.find((m) => m.slug === detailRow.listing.marketSlug) ?? null)
        : null,
    [detailRow, markets]
  );

  const setRef = (key: string) => (el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(key, el);
    else cardRefs.current.delete(key);
  };

  /** Nothing searched, no list open — the opening state. */
  const idle = !zip && !liveTarget && !listFilter;

  const countLabel = idle
    ? `${fmtNum(totals.rentals)} rentals across ${fmtNum(totals.markets)} markets`
    : zipActive
      ? `${fmtNum(filtered.length)} live rentals in ZIP ${zip}`
      : liveActive
        ? `${fmtNum(filtered.length)} live rentals in ${liveTarget!.name}`
        : listFilter && !liveTarget
          ? `${fmtNum(filtered.length)} saved`
          : `${fmtNum(filtered.length)} rentals in ${liveTarget?.name ?? "this area"}`;

  // Surface the day's remaining live searches only when it's getting
  // tight — a quiet heads-up, not a permanent counter.
  const remainingToday = zipActive
    ? zipResult?.remaining
    : liveActive
      ? live?.remaining
      : undefined;
  const showRemaining =
    typeof remainingToday === "number" && remainingToday <= 10;

  const asOfIso = zipActive ? zipResult?.asOf : liveActive ? live?.asOf : null;
  const liveAsOfLabel = asOfIso
    ? new Date(asOfIso).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col overflow-hidden contain-paint">
      {/* Filter chips — white chrome band pinned above both panes. */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-surface px-5 py-3.5">
        {/* Front and center, like Zillow: type a city or ZIP, pick, go.
            Lives outside the chip scroller so its dropdown never clips. */}
        <MarketSearchBox
          markets={markets}
          applied={zip ? `ZIP ${zip}` : filters.query}
          onApply={applyLocationQuery}
          onApplyZip={applyZipSearch}
          className="shrink-0"
        />

        <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-x-auto">
        <DealFilterChips
          filters={filters}
          states={states}
          featuresKnown={featuresKnown}
          onChange={(patch) => {
            if ("query" in patch) setZip(null);
            applyFilters(patch);
            setSelectedId(null);
            resetPaging();
          }}
        />

        {lists
          .filter((l) => l.listings.length > 0)
          .map((l) => {
            const on = listFilter === l.id;
            return (
              <button
                key={l.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setListFilter(on ? null : l.id);
                  resetPaging();
                }}
                className={cn(
                  "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors duration-150",
                  on
                    ? "border-gold/50 bg-gold-fill/10 text-gold"
                    : "border-border text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                )}
              >
                <Bookmark aria-hidden className="size-3.5" />
                <span className="max-w-28 truncate">{l.name}</span>
                <span className="tabular">{l.listings.length}</span>
              </button>
            );
          })}

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

        </div>

        <div className="ml-auto flex shrink-0 items-center gap-3 pl-3">
          {/* Amenity lookup — a feature filter that had to go read the
              listings says so, and says when it couldn't. */}
          {enriching ? (
            <span className="flex h-8 shrink-0 items-center gap-2 rounded-full border border-border bg-secondary/40 px-3.5 text-xs font-medium text-muted-foreground">
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
              Reading listings…
            </span>
          ) : enrichReason ? (
            <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3.5 text-xs font-medium text-muted-foreground">
              <Info aria-hidden className="size-3.5" />
              {enrichFailureLabel(enrichReason)}
            </span>
          ) : null}

          {/* Provenance — students always know which inventory they see. */}
          {zipActive || liveActive ? (
            <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-gold/50 bg-gold-fill/10 px-3.5 text-xs font-medium text-gold">
              <span aria-hidden className="size-1.5 rounded-full bg-gold-fill" />
              Live · {zipActive ? `ZIP ${zip}` : liveTarget!.name}
              {liveAsOfLabel ? (
                <span className="font-normal text-muted-foreground">
                  as of {liveAsOfLabel}
                </span>
              ) : null}
              {showRemaining ? (
                <span className="font-normal text-muted-foreground">
                  · {remainingToday} left today
                </span>
              ) : null}
            </span>
          ) : zipChecking || (liveTarget && liveChecking) ? (
            <span className="flex h-8 shrink-0 items-center rounded-full border border-border px-3.5 text-xs text-muted-foreground">
              Checking live listings…
            </span>
          ) : zipFailed ? (
            <span className="flex h-8 shrink-0 items-center rounded-full border border-border px-3.5 text-xs text-muted-foreground">
              {liveFailureLabel(zipResult?.reason)}
            </span>
          ) : liveTarget ? (
            <span className="flex h-8 shrink-0 items-center rounded-full border border-border px-3.5 text-xs text-muted-foreground">
              {liveFailureLabel(liveReason)} · showing preview
            </span>
          ) : null}

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
            listings={mapListings}
            focus={mapFocus}
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
          {idle ? (
            /* The opening invitation — a portal asks where before what. */
            <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center">
              <span
                aria-hidden
                className="flex size-11 items-center justify-center rounded-full border border-border bg-secondary/60 text-gold"
              >
                <Search className="size-5" />
              </span>
              <h2 className="mt-4 font-display text-xl font-medium tracking-tight text-foreground">
                Where are you hunting?
              </h2>
              <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
                Search a city or ZIP to pull the rentals listed there right
                now, each one scored against what short-term rentals actually
                earn in that market.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-1.5">
                {STARTER_MARKETS.map((slug) => {
                  const m = markets.find((x) => x.slug === slug);
                  if (!m) return null;
                  return (
                    <button
                      key={slug}
                      type="button"
                      onClick={() =>
                        applyLocationQuery(`${m.name}, ${m.stateCode}`)
                      }
                      className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:border-gold/40 hover:bg-gold-fill/5 hover:text-foreground"
                    >
                      {m.name}, {m.stateCode}
                    </button>
                  );
                })}
              </div>
              {lists.some((l) => l.listings.length > 0) ? (
                <p className="mt-6 text-xs text-muted-foreground">
                  Or open a saved list from the toolbar above.
                </p>
              ) : null}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={SearchX}
                title={
                  zipFailed
                    ? liveFailureLabel(zipResult?.reason)
                    : zipActive
                      ? `No active rentals in ZIP ${zip}`
                      : "No rentals match"
                }
                description={
                  zipFailed
                    ? zipResult?.reason === "auth"
                      ? "The rental feed rejected the API key. Check RENTCAST_API_KEY, then search again — ZIP search reads live inventory only."
                      : zipResult?.reason === "daily-cap"
                        ? "This app pulls a limited number of new areas live each day so the data bill stays predictable. It resets at midnight UTC, and areas already searched today still load instantly."
                        : zipResult?.reason === "quota"
                          ? "This month's live-feed requests are used up. Market searches still browse the preview inventory."
                          : "ZIP search reads live inventory only, and the feed didn't answer. Search a market by name to browse the preview set."
                      : zipActive
                        ? "Nothing is listed for rent there right now. Try a nearby ZIP or search the market by name."
                        : filters.query
                          ? "Check the spelling, or pick a market from the search suggestions — they cover all 387."
                          : "These filters rule out every listing we track. Loosen one and the grid comes back."
                }
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
                    onOpen={openDetail}
                    featureFilterActive={wantsFeatures}
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

      <ListingDetailDialog
        listing={detailRow?.listing ?? null}
        market={detailMarket}
        open={detailId !== null}
        onOpenChange={(next) => {
          if (!next) setDetailId(null);
        }}
      />
    </div>
  );
}
