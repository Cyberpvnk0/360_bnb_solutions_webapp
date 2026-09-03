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
import { estimateDeal, type DealRead } from "@/lib/mock/rentals";
import type { Market, RentalListing } from "@/lib/mock/types";
import { marketSearchText } from "@/lib/mock/market-aliases";
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
  getRedfinFurnished,
  redfinFailureLabel,
  type RedfinFailureReason,
} from "@/lib/data/redfin";
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

/**
 * How many cards load their picture eagerly.
 *
 * Two columns of roughly-112px cards: six covers the opening viewport
 * with one row of headroom. The rest stay lazy, which is right for
 * them and wrong for these — marking an on-screen image lazy asks the
 * browser to deprioritise the very thing the student is waiting on.
 */
const EAGER_IMAGES = 6;

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
  /** Cushion, cash flow and nightly rate, from lib/mock/rentals (which
   *  runs lib/calc). Computed once here so the card, the sort and the
   *  detail panel are all reading the same arithmetic. */
  deal: DealRead;
  /** Lowercased market-name/state haystack for the Location search. */
  haystack: string;
  /** Punctuation-blind haystack for the Keywords filter: the listing's
   *  DESCRIPTION plus its features, address, market and home type — the
   *  same surface Zillow's keyword search reads. */
  keywordHaystack: string;
}

const SORTERS: Record<SortKey, (a: Row, b: Row) => number> = {
  spread: (a, b) => b.deal.cushionPts - a.deal.cushionPts,
  // A listing whose age we don't know sorts last, never as the freshest.
  newest: (a, b) =>
    (a.listing.daysOnMarket ?? Number.POSITIVE_INFINITY) -
    (b.listing.daysOnMarket ?? Number.POSITIVE_INFINITY),
  "rent-asc": (a, b) => a.listing.rentMonthly - b.listing.rentMonthly,
  "rent-desc": (a, b) => b.listing.rentMonthly - a.listing.rentMonthly,
};

export function matchesFilters(row: Row, f: DealFilters): boolean {
  const l = row.listing;
  // Token matching survives real typing: "jacksonville florida",
  // "Jacksonville, FL", and "jacksonville" all resolve the same market.
  if (f.query && !marketMatchesQuery(row.haystack, f.query)) return false;
  // Slider bounds at their extremes mean "no bound" — the default view
  // must show every listing, including any outside the slider's track.
  if (f.rentMin > DEFAULT_DEAL_FILTERS.rentMin && l.rentMonthly < f.rentMin) {
    return false;
  }
  if (f.rentMax < DEFAULT_DEAL_FILTERS.rentMax && l.rentMonthly > f.rentMax) {
    return false;
  }
  // Exact sizes, not a floor. The top tile is open-ended, so a 5 keeps
  // anything with five or more; a half bath rounds down, because 2.5 is
  // what people call a two-bath.
  if (f.beds.length > 0 && !f.beds.includes(Math.min(5, l.bedrooms))) {
    return false;
  }
  if (f.baths.length > 0 && !f.baths.includes(Math.min(5, Math.floor(l.bathrooms)))) {
    return false;
  }
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
  /** Coverage figures for the opening invitation. */
  totals: { rentals: number; markets: number };
  /** A location to open on, from ?market= — how a deal, an analysis or
   *  a listing hands off to "the rentals here". */
  initialQuery?: string;
}

export function DealsExplorer({
  markets,
  totals,
  initialQuery = "",
}: DealsExplorerProps) {
  const [filters, setFilters] = React.useState<DealFilters>(
    // Seeded from ?market=, so arriving from a deal or an analysis lands
    // on that market's inventory rather than an empty search box.
    initialQuery
      ? { ...DEFAULT_DEAL_FILTERS, query: initialQuery }
      : DEFAULT_DEAL_FILTERS
  );
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
    /** The covered market this ZIP sits in. Anchors cushion math — and
     *  it is the only thing Furnished can be asked about, because that
     *  filter is answered by a city search and a ZIP is not a city. */
    market?: string | null;
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
        market: result.market,
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
    const hits = markets.filter((m) => marketMatchesQuery(marketSearchText(m), q));
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
  /* Furnished: answered by Redfin, not by reading prose               */
  /*                                                                    */
  /* Redfin ships a Furnished filter in its own search, so asking them
     for furnished rentals returns units that are furnished because THEY
     say so. That replaced an earlier attempt to mine the word out of
     scraped listing text, which on a live run tagged listings off a
     site's navigation footer. One request per market, cached a day.    */
  /* ---------------------------------------------------------------- */

  const [redfin, setRedfin] = React.useState<{
    slug: string;
    listings: RentalListing[];
  } | null>(null);
  const [redfinReason, setRedfinReason] =
    React.useState<RedfinFailureReason | null>(null);
  /** The market Redfin has answered for — "checking" is derived from
   *  it, so nothing is assigned synchronously inside an effect. */
  const [redfinChecked, setRedfinChecked] = React.useState<string | null>(null);

  /**
   * The market Furnished gets asked about.
   *
   * Furnished is answered by a city search, so a ZIP cannot be asked
   * directly. But a ZIP sits inside a city and that city can be, which
   * turns "this filter does nothing here" into an answer — a WIDER one
   * than was searched, which the chip and the count both say out loud
   * rather than quietly swapping the area under somebody.
   */
  const furnishedMarket = React.useMemo(() => {
    if (liveTarget) return liveTarget;
    const slug = zipResult?.zip === zip ? zipResult.market : null;
    return slug ? (markets.find((m) => m.slug === slug) ?? null) : null;
  }, [liveTarget, zipResult, zip, markets]);

  /** True when the furnished set covers a whole city rather than the
   *  ZIP that was actually typed. */
  const furnishedWidened = Boolean(!liveTarget && furnishedMarket);

  const furnishedTarget =
    filters.furnishedOnly && furnishedMarket ? furnishedMarket.slug : null;
  /** True once Redfin has answered for the market we're asking about. */
  const redfinActive = Boolean(
    furnishedTarget && redfin?.slug === furnishedTarget
  );

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
    // Furnished swaps the source outright: Redfin answers that question
    // at its own search, so the result set IS the furnished set rather
    // than a general set we then guess our way through.
    const source = redfinActive
      ? redfin!.listings
      : zip
        ? zipActive
          ? zipResult!.listings
          : []
        : marketRows
          ? marketRows
          : listFilter
            ? (lists.find((l) => l.id === listFilter)?.listings ?? [])
            : [];
    return source.flatMap((raw) => {
      const market = bySlug.get(raw.marketSlug);
      if (!market) return [];
      const listing = raw;
      return [
        {
          listing,
          deal: estimateDeal(listing, market),
          haystack: marketSearchText(market),
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
  }, [
    markets,
    marketRows,
    zip,
    zipActive,
    zipResult,
    listFilter,
    lists,
    redfinActive,
    redfin,
  ]);

  const applyFilters = React.useCallback((patch: Partial<DealFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  // Any change of lens starts the list from the top.
  const resetPaging = () => {
    setVisibleCount(PAGE_SIZE);
    listRef.current?.scrollTo({ top: 0 });
  };

  // The Furnished chip stays usable whenever something can answer it:
  // rows that already know their amenities, or a market Redfin can be
  // asked about. It only greys out once Redfin has said it can't help.
  const canAskRedfin = Boolean(furnishedMarket) && redfinReason === null;
  const featuresKnown =
    rows.length === 0 ||
    rows.some((r) => r.listing.featuresKnown !== false) ||
    canAskRedfin;

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

  // Asking Redfin costs a request, so it happens only once a student
  // actually turns Furnished on, and only for a single named market.
  React.useEffect(() => {
    if (!furnishedTarget) return;
    let cancelled = false;
    getRedfinFurnished(furnishedTarget).then((result) => {
      if (cancelled) return;
      setRedfin(
        result.live ? { slug: furnishedTarget, listings: result.listings } : null
      );
      setRedfinReason(result.live ? null : (result.reason ?? "network"));
      setRedfinChecked(furnishedTarget);
    });
    return () => {
      cancelled = true;
    };
  }, [furnishedTarget]);

  /** Derived, never assigned inside the effect. */
  const redfinChecking = Boolean(
    furnishedTarget && redfinChecked !== furnishedTarget
  );

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

  /**
   * The feed has been asked and hasn't answered.
   *
   * Worth its own branch, because without one an in-flight search falls
   * through to the no-results state and tells a student their filters
   * rule out every listing — while the real answer is still in the
   * post. A market nobody has searched today has nothing cached to
   * ride, so that wait is at its longest exactly when the screen is at
   * its least honest.
   */
  const awaitingFeed =
    zipChecking || redfinChecking || Boolean(liveTarget && liveChecking);

  /**
   * The feed answered for this market and had nothing in it.
   *
   * Not the same as filters being too tight, and saying so matters:
   * "loosen a filter" is advice that cannot work, and it sends someone
   * hunting through controls for a problem that isn't there.
   */
  const marketEmpty = Boolean(
    liveTarget && !awaitingFeed && (marketRows?.length ?? 0) === 0
  );

  const countLabel = idle
    ? `${fmtNum(totals.rentals)} rentals across ${fmtNum(totals.markets)} markets`
    : redfinActive
      ? `${fmtNum(filtered.length)} furnished rentals in ${
          furnishedMarket?.name ?? "this area"
        }${furnishedWidened ? `, not just ZIP ${zip}` : ""}`
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
          {redfinChecking ? (
            <span className="flex h-8 shrink-0 items-center gap-2 rounded-full border border-border bg-secondary/40 px-3.5 text-xs font-medium text-muted-foreground">
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
              Finding furnished rentals…
            </span>
          ) : redfinActive ? (
            <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-gold/50 bg-gold-fill/10 px-3.5 text-xs font-medium text-gold">
              <span aria-hidden className="size-1.5 rounded-full bg-gold-fill" />
              Furnished
              {furnishedWidened ? (
                <span className="font-normal text-muted-foreground">
                  · {furnishedMarket?.name} city-wide
                </span>
              ) : null}
            </span>
          ) : redfinReason ? (
            <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3.5 text-xs font-medium text-muted-foreground">
              <Info aria-hidden className="size-3.5" />
              {redfinFailureLabel(redfinReason)}
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
            loading={awaitingFeed}
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
          ) : awaitingFeed && filtered.length === 0 ? (
            <div className="grid grid-cols-1 gap-5 p-5 xl:grid-cols-2">
              {Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  className="overflow-hidden rounded-lg border border-border bg-card"
                >
                  <div className="h-28 w-full animate-pulse bg-secondary/70" />
                  <div className="space-y-2 p-4">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-secondary/70" />
                    <div className="h-3 w-1/3 animate-pulse rounded bg-secondary/60" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={SearchX}
                title={
                  // Furnished FIRST: when it is on, the result set IS
                  // the furnished set. A ZIP search with Furnished on
                  // was reporting "no active rentals in ZIP 33602"
                  // while running a city-wide furnished query, which
                  // blames the wrong thing and hides the real one.
                  redfinActive && (redfin?.listings.length ?? 0) === 0
                    ? `No furnished rentals listed in ${
                        furnishedMarket?.name ?? "this area"
                      }`
                    : zipFailed
                    ? liveFailureLabel(zipResult?.reason)
                    : zipActive
                      ? `No active rentals in ZIP ${zip}`
                      : marketEmpty
                          ? `Nothing listed for rent in ${liveTarget!.name} right now`
                          : "No rentals match"
                }
                description={
                  redfinActive && (redfin?.listings.length ?? 0) === 0
                    ? "The feed carries no furnished units here today. Turn Furnished off to see everything else listed."
                    : zipFailed
                    ? zipResult?.reason === "auth"
                      ? "The rental feed rejected this app's access key, so live inventory can't load. Whoever runs the deployment needs to check the live-feed key in its settings; market searches still browse the preview set."
                      : zipResult?.reason === "daily-cap"
                        ? "This app pulls a limited number of new areas live each day so the data bill stays predictable. It resets at midnight UTC, and areas already searched today still load instantly."
                        : zipResult?.reason === "quota"
                          ? "This month's live-feed requests are used up. Market searches still browse the preview inventory."
                          : "ZIP search reads live inventory only, and the feed didn't answer. Search a market by name to browse the preview set."
                      : zipActive
                        ? "Nothing is listed for rent there right now. Try a nearby ZIP or search the market by name."
                        : marketEmpty
                            ? "The feed answered for this market and had no active rentals in it — this isn't a filter you can loosen. Try a nearby market, or check back: inventory changes daily."
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
                {visible.map((r, i) => (
                  <ListingCard
                    key={r.listing.id}
                    ref={setRef(r.listing.id)}
                    listing={r.listing}
                    priority={i < EAGER_IMAGES}
                    deal={r.deal}
                    selected={r.listing.id === selectedId}
                    hovered={r.listing.id === hoveredId}
                    onHoverChange={setHoveredId}
                    onOpen={openDetail}
                    featureFilterActive={filters.furnishedOnly}
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
