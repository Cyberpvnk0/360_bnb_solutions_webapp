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
  ChevronDown,
  FileDown,
  Info,
  LayoutGrid,
  Loader2,
  Map as MapIcon,
  Search,
  SearchX,
  X,
} from "lucide-react";
import {
  getLiveRentals,
  getLiveRentalsByZip,
  type LiveFailureReason,
} from "@/lib/data";
import { toast } from "sonner";
import { csvFileName, downloadCsv, toCsv, type CsvColumn } from "@/lib/export/csv";
import { fmtNum } from "@/lib/format";
import { estimateDeal, type DealRead } from "@/lib/calc/deal-read";
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
import { FurnishedSearching } from "./furnished-searching";
import { collapseDuplicateListings } from "@/lib/live/dedupe-listings";
import { inZip } from "@/lib/live/zip";
import { dealFiguresFor, figuresWanted, useMarketFigures } from "./use-market-figures";
import { getZipBoundary } from "@/lib/data/zip-boundary";
import type { ZipBoundary } from "@/lib/map/zip-boundary";
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
  TYPE_LABEL,
  type DealFilters,
} from "./deal-filters";
import { MarketSearchBox } from "./market-search";
import { ListingAlerts } from "./listing-alerts";
import { ListingDetailDialog } from "./listing-detail-dialog";
import { ListingDock } from "./listing-dock";
import { Assistant } from "@/components/assistant/assistant";
import { MAX_ROWS as ASSISTANT_ROWS, type AssistantContext } from "@/lib/assistant/context";
import { gradeDeal } from "@/lib/calc/deal-grade";
import { ListingCard } from "./listing-card";
import { inBounds, RentalsMap, type MapBounds, type MapFocus } from "./rentals-map";
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

type SortKey = "spread" | "potential" | "newest" | "rent-asc" | "rent-desc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "spread", label: "Best spread" },
  { value: "potential", label: "Best Potential" },
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
}

/** The most a row could clear a month: the top of its range while it
 *  is an estimate, the analysis's own figure once it has one. */
function potentialOf(r: Row): number {
  return r.deal.netRange?.high ?? r.deal.netCashFlow;
}

const SORTERS: Record<SortKey, (a: Row, b: Row) => number> = {
  spread: (a, b) => b.deal.cushionPts - a.deal.cushionPts,
  potential: (a, b) => potentialOf(b) - potentialOf(a),
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
  return true;
}

/** Plain-language explanation of a live-feed miss — a wrong key must
 *  never read as "no listings here". */
function liveFailureLabel(
  reason: LiveFailureReason | null | undefined,
  creditLimit = 0
): string {
  switch (reason) {
    case "no-key":
      return "Live feed not configured";
    case "auth":
      return "Live feed key rejected";
    case "quota":
      return "Live feed quota reached";
    case "daily-cap":
      return "Daily live-search limit reached";
    case "monthly-cap":
      // A plan with none was never at a limit; it is looking at the
      // paid feature from outside, and the label should say so.
      return creditLimit > 0
        ? "This month's credits are used up"
        : "Live listings are on paid plans";
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
  /** A saved list to open on, from ?list= — the Saved page's way in. */
  initialList?: string | null;
}

export function DealsExplorer({
  markets,
  totals,
  initialQuery = "",
  initialList = null,
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
  /** The map's viewport once the person has moved it; the grid shows
   *  only rentals inside. Null until they do, and again after a new
   *  search frames the map. */
  const [viewBounds, setViewBounds] = React.useState<MapBounds | null>(null);
  /** Bumped by "Show all" so the map re-frames the searched area. */
  const [fitNonce, setFitNonce] = React.useState(0);
  const [mobilePane, setMobilePane] = React.useState<"list" | "map">("list");
  const [detailId, setDetailId] = React.useState<string | null>(null);
  /** The listing whose card is docked on the map — set by a pin click,
   *  cleared by its close button or a click on the map itself. */
  const [dockId, setDockId] = React.useState<string | null>(null);
  /** null = every listing; a list id = only that list's saved rentals. */
  const [listFilter, setListFilter] = React.useState<string | null>(initialList);
  const { ready, lists, openUpgrade, creditLimit, tier, recordExport } = useSession();
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
      if (result.reason === "monthly-cap") openUpgrade({ reason: "credits" });
    });
    return () => {
      cancelled = true;
    };
  }, [zip, openUpgrade]);

  // The ZIP's outline for the map, fetched the moment a ZIP is typed,
  // alongside its listings rather than after them.
  const [zipBoundary, setZipBoundary] = React.useState<ZipBoundary | null>(null);
  React.useEffect(() => {
    if (!zip) return;
    let cancelled = false;
    getZipBoundary(zip).then((b) => {
      if (!cancelled) setZipBoundary(b);
    });
    return () => {
      cancelled = true;
    };
  }, [zip]);
  const boundary = zip && zipBoundary?.zip === zip ? zipBoundary : null;

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
      // The plan, not the feed, said no. The rows on screen are the
      // market's preview set; the way to the real ones is a bigger plan,
      // and the modal says which and how many.
      if (result.reason === "monthly-cap") openUpgrade({ reason: "credits" });
    });
    return () => {
      cancelled = true;
    };
  }, [liveTarget, openUpgrade]);


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
  /** Why the last ask came back empty, and for which market — so the
   *  note it puts in the toolbar is never about a market that was not
   *  asked. */
  const [redfinReason, setRedfinReason] = React.useState<{
    slug: string;
    reason: RedfinFailureReason;
  } | null>(null);
  /** The market Redfin has answered for — "checking" is derived from
   *  it, so nothing is assigned synchronously inside an effect. */
  const [redfinChecked, setRedfinChecked] = React.useState<string | null>(null);

  /**
   * The market Furnished gets asked about.
   *
   * Furnished is answered by a city search, so a ZIP cannot be asked
   * directly. But a ZIP sits inside a city and that city can be: the
   * city's furnished set is bought once and cut down to the ZIP on the
   * way to the screen (see `rows`), so a ZIP search with Furnished on
   * shows that ZIP's furnished rentals and nothing wider. An earlier
   * version showed the whole city and said so in the count, which was
   * honest and still not what was typed.
   */
  const furnishedMarket = React.useMemo(() => {
    if (liveTarget) return liveTarget;
    const slug = zipResult?.zip === zip ? zipResult.market : null;
    return slug ? (markets.find((m) => m.slug === slug) ?? null) : null;
  }, [liveTarget, zipResult, zip, markets]);

  const furnishedTarget =
    filters.furnishedOnly && furnishedMarket ? furnishedMarket.slug : null;
  /** The miss for the market on screen, if the last ask was for it. */
  const redfinMiss =
    redfinReason && redfinReason.slug === furnishedMarket?.slug ? redfinReason.reason : null;
  /** True once Redfin has answered for the market we're asking about. */
  const redfinActive = Boolean(
    furnishedTarget && redfin?.slug === furnishedTarget
  );

  /**
   * What a market shows when the feed did not answer. A plan with no
   * markets is looking at the paid feature from outside, and the
   * preview set is what it is shown — labelled as such. A PAID account
   * was promised today's inventory, and a stand-in that looks like it
   * is worse than an empty grid that says why; it gets nothing.
   */
  const previewStandIn = creditLimit === 0;
  const marketRows = React.useMemo(
    () =>
      liveTarget && live?.slug === liveTarget.slug
        ? live.isLive || previewStandIn
          ? live.listings
          : []
        : null,
    [liveTarget, live, previewStandIn]
  );
  const liveActive = Boolean(
    liveTarget && live?.slug === liveTarget.slug && live.isLive
  );
  /** The feed refused or failed for a paid account: nothing stands in. */
  const liveFailed = Boolean(
    liveTarget && live?.slug === liveTarget.slug && !live.isLive && !previewStandIn
  );
  const liveChecking = Boolean(
    liveTarget && liveChecked !== liveTarget.slug
  );

  // The rows on screen: search-first. A ZIP is answered by the feed
  // alone, a market by its live rows (or its preview set when the feed
  // can't answer), a saved list by what's in it. With no search and no
  // list, nothing shows. Furnished swaps the source outright: Redfin
  // answers that question at its own search, so the result set IS the
  // furnished set rather than a general set we then guess our way
  // through. A live set is shown with its duplicates folded — the same
  // house under two lines, see lib/live/dedupe-listings. A saved list
  // is what was saved.
  const scoped = React.useMemo<RentalListing[]>(() => {
    const source = redfinActive
      ? collapseDuplicateListings(redfin!.listings)
      : zip
        ? zipActive
          ? collapseDuplicateListings(zipResult!.listings)
          : []
        : marketRows
          ? collapseDuplicateListings(marketRows)
          : listFilter
            ? (lists.find((l) => l.id === listFilter)?.listings ?? [])
            : [];
    // A ZIP search shows that ZIP and nothing else, whatever the source:
    // the furnished set above is a whole city's, and even the feed's own
    // ZIP answer is checked row by row. See lib/live/zip.
    return zip ? source.filter((l) => inZip(l, zip)) : source;
  }, [marketRows, zip, zipActive, zipResult, listFilter, lists, redfinActive, redfin]);

  // The measured figures the cards are projected from — the feed's own
  // ADR and occupancy for each row's ZIP, and for its city until the
  // ZIP is known. The catalogue's modelled figures stand in only when
  // the feed has none, and the card says so. Preview inventory is
  // modelled through and through and asks for nothing. See
  // lib/live/market-figures.
  const wanted = React.useMemo(() => figuresWanted(scoped), [scoped]);
  const figures = useMarketFigures(wanted, !previewStandIn);

  // Join listings with their market once — cushion comes through
  // lib/mock/rentals (lib/calc underneath), never an inline formula.
  const rows = React.useMemo<Row[]>(() => {
    const bySlug = new Map(markets.map((m) => [m.slug, m]));
    return scoped.flatMap((raw) => {
      const market = bySlug.get(raw.marketSlug);
      if (!market) return [];
      const listing = raw;
      const basis = dealFiguresFor(listing, market, figures);
      return [
        {
          listing,
          deal: estimateDeal(listing, market, basis.figures, { pending: basis.pending }),
          haystack: marketSearchText(market),
        },
      ];
    });
  }, [markets, scoped, figures]);

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
  // asked about. An ask that failed does not grey it out — it turned
  // the filter back off and said why, and the next click asks again.
  // Greyed means nothing here can ever answer.
  const canAskRedfin = Boolean(furnishedMarket);
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
      // What the map is looking at, once the person has moved it.
      .filter((r) => !viewBounds || inBounds(r.listing, viewBounds))
      .sort(by);
  }, [rows, filters, sort, listFilter, lists, viewBounds]);

  const visible = React.useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount]
  );
  const remaining = Math.max(0, filtered.length - visibleCount);

  /**
   * The lead list, as filtered and sorted on screen, to a CSV. What a
   * card shows is what a row carries: the property, its asking rent,
   * the read beside it, the listing's own contact when it published
   * one, and the listing page. No prose, no photos — the same rule as
   * the screen. Scale includes the export; other plans see the plan.
   */
  const exportLeads = () => {
    if (!tier.csvExport) {
      openUpgrade({ reason: "export" });
      return;
    }
    const bySlug = new Map(markets.map((m) => [m.slug, m.name]));
    const columns: CsvColumn<Row>[] = [
      { header: "Address", value: (r) => r.listing.address },
      { header: "City", value: (r) => r.listing.city },
      { header: "State", value: (r) => r.listing.stateCode },
      { header: "Market", value: (r) => bySlug.get(r.listing.marketSlug) ?? r.listing.marketSlug },
      {
        header: "Type",
        value: (r) =>
          r.listing.propertyTypeKnown === false ? "" : TYPE_LABEL[r.listing.propertyType],
      },
      { header: "Bedrooms", value: (r) => r.listing.bedrooms },
      { header: "Bathrooms", value: (r) => r.listing.bathrooms },
      { header: "Sq ft", value: (r) => r.listing.sqft || "" },
      { header: "Asking rent / mo ($)", value: (r) => r.listing.rentMonthly },
      { header: "Days on market", value: (r) => r.listing.daysOnMarket ?? "" },
      { header: "Pet friendly", value: (r) => r.listing.petFriendly },
      { header: "Est. nightly rate ($)", value: (r) => Math.round(r.deal.nightlyRate) },
      { header: "Breakeven occupancy (%)", value: (r) => Math.round(r.deal.breakeven * 100) },
      { header: "Cushion (pts)", value: (r) => r.deal.cushionPts },
      { header: "Est. net cash flow / mo ($)", value: (r) => Math.round(r.deal.netCashFlow) },
      { header: "Est. net low / mo ($)", value: (r) => r.deal.netRange?.low ?? "" },
      { header: "Est. net high / mo ($)", value: (r) => r.deal.netRange?.high ?? "" },
      { header: "Analyzed", value: (r) => r.deal.basis.kind === "comps" },
      { header: "Contact", value: (r) => r.listing.contact?.name ?? "" },
      { header: "Contact company", value: (r) => r.listing.contact?.company ?? "" },
      { header: "Contact phone", value: (r) => r.listing.contact?.phone ?? "" },
      { header: "Contact email", value: (r) => r.listing.contact?.email ?? "" },
      { header: "Contact role", value: (r) => r.listing.contact?.role ?? "" },
      { header: "Listing page", value: (r) => r.listing.sourceUrl ?? "" },
    ];
    const stem = zip
      ? `leads-zip-${zip}`
      : liveTarget
        ? `leads-${liveTarget.slug}`
        : listFilter
          ? `leads-${lists.find((l) => l.id === listFilter)?.name ?? "list"}`
          : "leads";
    downloadCsv(csvFileName(stem), toCsv(filtered, columns));
    recordExport(`${fmtNum(filtered.length)} leads`, "/deals");
    toast.success(`Exported ${fmtNum(filtered.length)} rentals`);
  };

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
      setRedfinChecked(furnishedTarget);
      if (result.live) {
        setRedfinReason(null);
        return;
      }
      // No answer: the filter comes back off rather than staying lit
      // over an unfiltered list, and the toolbar says why. The chip
      // stays clickable, so trying again is one click.
      setRedfinReason({ slug: furnishedTarget, reason: result.reason ?? "network" });
      setFilters((prev) => (prev.furnishedOnly ? { ...prev, furnishedOnly: false } : prev));
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
    // The ZIP's own outline frames the search once it is known. Its key
    // differs from the listings' one below, so the camera moves from
    // the listings' box to the ZIP's the moment the shape arrives.
    if (boundary) {
      const [w, s, e, n] = boundary.bbox;
      return {
        key: `zip-${zip}#${fitNonce}#outline`,
        lat: (s + n) / 2,
        lon: (w + e) / 2,
        radiusMiles: 6,
        bounds: boundary.bbox,
      };
    }
    if (zipActive && zipResult?.center) {
      return {
        key: `zip-${zip}#${fitNonce}`,
        lat: zipResult.center.lat,
        lon: zipResult.center.lon,
        radiusMiles: 6,
      };
    }
    // A market search frames its whole 30-mile metro whether the rows
    // came from the feed or the preview set.
    if (liveTarget) {
      return {
        key: `market-${liveTarget.slug}#${fitNonce}`,
        lat: liveTarget.lat,
        lon: liveTarget.lon,
        radiusMiles: 30,
      };
    }
    return null;
  }, [boundary, zipActive, zipResult, zip, liveTarget, fitNonce]);

  const hasActiveFilters =
    !isDefaultDealFilters(filters) || zip !== null || listFilter !== null;
  const resetFilters = () => {
    setFilters(DEFAULT_DEAL_FILTERS);
    setZip(null);
    setViewBounds(null);
    setZipResult(null);
    setListFilter(null);
    resetPaging();
  };

  const applyLocationQuery = (query: string) => {
    setZip(null);
    setViewBounds(null);
    applyFilters({ query });
    setSelectedId(null);
    resetPaging();
  };

  const applyZipSearch = (nextZip: string) => {
    applyFilters({ query: "" });
    setZip(nextZip);
    setViewBounds(null);
    setSelectedId(null);
    resetPaging();
  };

  /** The map settled after the person moved it: show what it shows.
   *  Null lifts the constraint (a search re-framed the map). */
  const handleViewportChange = React.useCallback((bounds: MapBounds | null) => {
    setViewBounds(bounds);
    setVisibleCount(PAGE_SIZE);
    listRef.current?.scrollTo({ top: 0 });
  }, []);

  /** "Show all": lift the constraint and frame the searched area again. */
  const resetView = React.useCallback(() => {
    setViewBounds(null);
    setFitNonce((n) => n + 1);
    setVisibleCount(PAGE_SIZE);
  }, []);

  /** Pill click: select the listing, open its panel, and line the card
   *  up behind it so closing the panel lands you in the right place. */
  const selectFromMap = React.useCallback((id: string) => {
    // A pin click docks the listing's card on the map — the way every
    // property portal answers a pin — rather than opening the full
    // panel over it. The panel is one button away on the card.
    setSelectedId(id);
    setDockId(id);
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
  const dockRow = React.useMemo(
    () => (dockId ? rows.find((r) => r.listing.id === dockId) : undefined),
    [dockId, rows]
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

  // What the assistant is looking at: the search, its first rows as
  // the grid orders them, and the rental open on the map, if one is.
  // Nothing before a search: there is nothing to ask about yet.
  const assistantContext = React.useMemo<AssistantContext | null>(() => {
    if (idle) return null;
    const label = zip
      ? `ZIP ${zip}`
      : liveTarget
        ? `${liveTarget.name}, ${liveTarget.stateCode}`
        : (lists.find((l) => l.id === listFilter)?.name ?? "Saved rentals");
    const market = liveTarget ?? furnishedMarket ?? null;
    const selected = dockRow?.listing ?? detailRow?.listing ?? null;
    return {
      kind: "search",
      id: `search:${label}`,
      label,
      market: market
        ? {
            name: market.name,
            stateCode: market.stateCode,
            regulation: { status: market.regulation.status, note: market.regulation.note },
          }
        : null,
      total: filtered.length,
      rows: filtered.slice(0, ASSISTANT_ROWS).map((r) => ({
        address: r.listing.address,
        city: r.listing.city,
        stateCode: r.listing.stateCode,
        ...(r.listing.zip ? { zip: r.listing.zip } : {}),
        bedrooms: r.listing.bedrooms,
        bathrooms: r.listing.bathrooms,
        rentMonthly: r.listing.rentMonthly,
        net: Math.round(r.deal.netCashFlow),
        netRange: r.deal.netRange,
        grade: gradeDeal(r.deal.cushionPts, { potential: r.deal.basis.kind !== "comps" }).label,
        analyzed: r.deal.basis.kind === "comps",
        ...(r.listing.sourceUrl ? { sourceUrl: r.listing.sourceUrl } : {}),
      })),
      ...(selected ? { selected: selected.address } : {}),
    };
  }, [idle, zip, liveTarget, lists, listFilter, furnishedMarket, dockRow, detailRow, filtered]);

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
  /** Opened on ?list= before the account's lists have arrived: the
   *  list is not missing, it is in the post, and the empty state must
   *  not say otherwise. */
  const awaitingLists = Boolean(listFilter && !ready);

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
          zip ? `ZIP ${zip}` : (furnishedMarket?.name ?? "this area")
        }`
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
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:px-5 sm:py-3.5">
        {/* Front and center, like Zillow: type a city or ZIP, pick, go.
            Lives outside the chip scroller so its dropdown never clips. */}
        <MarketSearchBox
          markets={markets}
          applied={zip ? `ZIP ${zip}` : filters.query}
          onApply={applyLocationQuery}
          onApplyZip={applyZipSearch}
          className="w-full shrink-0 sm:w-auto"
        />

        <div className="-mx-4 flex min-w-0 flex-1 items-center gap-2.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        <DealFilterChips
          filters={filters}
          featuresKnown={featuresKnown}
          onChange={(patch) => {
            if ("query" in patch) setZip(null);
            // Furnished going on is a fresh ask: the last miss and the
            // last answer's market are forgotten, so the ask shows as
            // one in progress rather than as the old result.
            if (patch.furnishedOnly === true) {
              setRedfinReason(null);
              setRedfinChecked(null);
            }
            applyFilters(patch);
            setSelectedId(null);
            resetPaging();
          }}
        />

        {/* A saved list opens here from the Saved page (?list=). The one
            that is open shows, with the way out; the rest live on the
            Saved page rather than as a row of chips in the band. */}
        {listFilter
          ? (() => {
              const open = lists.find((l) => l.id === listFilter);
              return open ? (
                <button
                  type="button"
                  aria-pressed
                  onClick={() => {
                    setListFilter(null);
                    resetPaging();
                  }}
                  title="Show every rental again"
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-select/50 bg-select/10 px-3.5 text-xs font-medium text-select transition-colors duration-150 hover:bg-select/15"
                >
                  <Bookmark aria-hidden className="size-3.5" />
                  <span className="max-w-28 truncate">{open.name}</span>
                  <span className="tabular">{open.listings.length}</span>
                  <X aria-hidden className="size-3" />
                </button>
              ) : null;
            })()
          : null}

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
            </span>
          ) : redfinMiss ? (
            <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3.5 text-xs font-medium text-muted-foreground">
              <Info aria-hidden className="size-3.5" />
              {redfinFailureLabel(redfinMiss)}
            </span>
          ) : null}

          {/* Alerts for the area on screen: new rentals that fit the
              filters, by mail or push, each morning. */}
          {zip || liveTarget ? (
            <ListingAlerts
              scope={
                zip
                  ? { marketSlug: null, zip, label: `ZIP ${zip}` }
                  : { marketSlug: liveTarget!.slug, zip: null, label: `${liveTarget!.name}, ${liveTarget!.stateCode}` }
              }
              filters={filters}
              defaults={DEFAULT_DEAL_FILTERS}
            />
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
              {liveFailureLabel(liveReason, creditLimit)}
              {previewStandIn ? " · showing preview" : ""}
            </span>
          ) : null}

          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={exportLeads}
            disabled={filtered.length === 0}
            title="Export the rentals on screen as a spreadsheet"
          >
            <FileDown aria-hidden className="size-3.5" />
            Export CSV
          </Button>

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
            {viewBounds ? `${countLabel} · in map view` : countLabel}
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
                ? "border-select text-foreground"
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
            boundary={boundary}
            dock={
              dockRow ? (
                <ListingDock
                  listing={dockRow.listing}
                  deal={dockRow.deal}
                  onClose={() => setDockId(null)}
                  onDetails={() => openDetail(dockRow.listing.id)}
                />
              ) : null
            }
            onClear={() => {
              setDockId(null);
              setSelectedId(null);
            }}
            onViewportChange={handleViewportChange}
            viewFiltered={viewBounds !== null}
            onResetView={resetView}
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
              <h2 className="mt-4 font-display text-xl font-semibold tracking-tight text-foreground">
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
                      className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:border-select/40 hover:bg-select/5 hover:text-foreground"
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
          ) : redfinChecking ? (
            /* The long wait, named: the market's listings are being
               read live. Grey cards for half a minute read as a page
               that had hung; this says what is happening and shows
               time passing. */
            <FurnishedSearching
              market={zip ? `ZIP ${zip}` : (furnishedMarket?.name ?? "this area")}
            />
          ) : (awaitingFeed || awaitingLists) && filtered.length === 0 ? (
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
                  redfinActive && rows.length === 0
                    ? `No furnished rentals listed in ${
                        zip ? `ZIP ${zip}` : (furnishedMarket?.name ?? "this area")
                      }`
                    : zipFailed
                    ? liveFailureLabel(zipResult?.reason)
                    : liveFailed
                      ? liveFailureLabel(liveReason, creditLimit)
                    : listFilter && !liveTarget && !zip
                      ? lists.some((l) => l.id === listFilter)
                        ? `${lists.find((l) => l.id === listFilter)?.name ?? "This list"} is empty`
                        : "That list isn't here"
                    : zipActive
                      ? `No active rentals in ZIP ${zip}`
                      : marketEmpty
                          ? `Nothing listed for rent in ${liveTarget!.name} right now`
                          : "No rentals match"
                }
                description={
                  redfinActive && rows.length === 0
                    ? "The feed carries no furnished units here today. Turn Furnished off to see everything else listed."
                    : zipFailed
                    ? zipResult?.reason === "auth"
                      ? "The rental feed rejected this app's access key, so live inventory can't load. Whoever runs the deployment needs to check the live-feed key in its settings; market searches still browse the preview set."
                      : zipResult?.reason === "daily-cap"
                        ? "This app pulls a limited number of new areas live each day so the data bill stays predictable. It resets at midnight UTC, and areas already searched today still load instantly."
                        : zipResult?.reason === "quota"
                          ? "This month's live-feed requests are used up. Market searches still browse the preview inventory."
                          : "ZIP search reads live inventory only, and the feed didn't answer. Search a market by name to browse the preview set."
                      : liveFailed
                        ? liveReason === "monthly-cap"
                          ? `You've opened every market the ${tier.name} plan includes this month. Markets you've already opened still load; a bigger plan opens more.`
                          : liveReason === "daily-cap"
                            ? "This app pulls a limited number of new markets live each day so the data bill stays predictable. It resets at midnight UTC; markets already opened today still load instantly."
                            : liveReason === "quota"
                              ? "This month's live-feed requests are used up. Nothing is shown in their place."
                              : `The live feed didn't answer for ${liveTarget?.name ?? "this market"}. Nothing stands in for today's inventory — try again in a moment.`
                      : listFilter && !liveTarget && !zip
                        ? lists.some((l) => l.id === listFilter)
                          ? "Save rentals to it from any listing with Add to list, and they show here."
                          : "It may have been deleted, or it belongs to another account. Your lists are under Saved; or search a market."
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
                  <button
                    type="button"
                    onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                    className={cn(
                      "inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card pr-5 pl-4 text-sm font-semibold text-foreground",
                      "shadow-[0_1px_2px_rgba(16,16,18,0.06),0_6px_18px_rgba(16,16,18,0.1)] transition-[transform,box-shadow,border-color] duration-150",
                      "hover:-translate-y-0.5 hover:border-gold/60 hover:shadow-[0_2px_4px_rgba(16,16,18,0.08),0_10px_24px_rgba(16,16,18,0.14)] active:translate-y-0"
                    )}
                  >
                    <span className="flex size-6 items-center justify-center rounded-full bg-gold-fill/15 text-gold">
                      <ChevronDown aria-hidden className="size-3.5" strokeWidth={2.5} />
                    </span>
                    Show {Math.min(PAGE_SIZE, remaining)} more
                    <span className="font-normal text-muted-foreground">· {fmtNum(remaining)} remaining</span>
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {assistantContext ? <Assistant context={assistantContext} /> : null}

      <ListingDetailDialog
        listing={detailRow?.listing ?? null}
        market={detailMarket}
        deal={detailRow?.deal ?? null}
        open={detailId !== null}
        onOpenChange={(next) => {
          if (!next) setDetailId(null);
        }}
      />
    </div>
  );
}
