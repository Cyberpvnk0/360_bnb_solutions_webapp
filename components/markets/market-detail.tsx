"use client";

/**
 * One market, read properly.
 *
 * THREE KINDS OF NUMBER, NEVER MIXED AND ALWAYS LABELLED. Measured is
 * what a short-let data provider answered for this city, bought once
 * and shared by every account. Seen is a median of the real listings
 * this product has encountered — the comp sets every analysis in the
 * city leaves behind, and the rentals a search brought in — which is a
 * sample and says so. Estimate is the catalogue's researched median
 * lease, which is a bracket rather than a quote. A screen that let a
 * reader take one for another would be worse than one that showed
 * fewer numbers.
 *
 * The areas are ZIPs, because a ZIP is a real boundary and the feed
 * answers at that grain natively. See lib/markets/areas for why there
 * are no neighbourhood names here.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Binoculars,
  Loader2,
  MapPin,
  Ruler,
  Search,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import {
  annualRevenueFromAdr,
  breakevenOccupancy,
  marginOfSafety,
  netCashFlow,
  revpar,
} from "@/lib/calc/arbitrage";
import {
  fmtMoney,
  fmtMoneyShort,
  fmtMonth,
  fmtNum,
  fmtPct,
  fmtWhen,
} from "@/lib/format";
import {
  AREA_MEASURE_CREDITS,
} from "@/config/app";
import { HINTS } from "@/lib/copy/hints";
import {
  AREA_SORTS,
  MIN_COMPS,
  sortAreas,
  versusMarket,
  type AreaRow,
  type AreaSort,
  type MeasuredArea,
} from "@/lib/markets/areas";
import { RULE_LABEL, RULE_TONE, TERRAIN_LABEL } from "@/lib/markets/explorer";
import { MIN_RENTALS, bestSize, type SizeRow } from "@/lib/markets/sizes";
import {
  bandLabel,
  type AmenityReading,
  type AmenityRow,
} from "@/lib/markets/amenities";
import {
  FIELD_NOTE,
  fieldOf,
  type CompetitionReading,
} from "@/lib/markets/competition";
import { benchmark2brInputs } from "@/lib/mock/markets";
import type { Market } from "@/lib/mock/types";
import type { StoredMarketStats } from "@/lib/db/market-store";
import type { LiveMarketMonth, LiveMarketPace } from "@/lib/live/airroi";
import { lastYearByMonth, paceMonths } from "@/lib/live/market-pacing";
import {
  asTooltipContent,
  AXIS_PROPS,
  CHART,
  GRID_PROPS,
  makeTooltip,
} from "@/components/charts/kit";
import { DataTable, type DataTableColumn } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { InfoHint } from "@/components/primitives/info-hint";
import { StatusChip } from "@/components/primitives/status-chip";
import { Button } from "@/components/ui/button";
import { useFinePointer } from "@/components/primitives/use-pointer-kind";
import { actionLabel } from "@/lib/ui/pointer";
import { useSession } from "@/components/providers/session-provider";
import { MEASURE_PRICE, useMeasureMarket } from "./use-measure-market";
import { MarketMeasuring } from "./market-measuring";
import { SaveMarketButton } from "./save-market-button";
import { cn } from "@/lib/utils";

/** What a measure costs, said the way a reader says it. */
const PRICE = `${AREA_MEASURE_CREDITS} ${AREA_MEASURE_CREDITS === 1 ? "credit" : "credits"}`;

/** A figure nobody has measured. Never a zero. */
const NONE = <span className="text-muted-foreground/60">—</span>;

interface Props {
  market: Market;
  stats: StoredMarketStats | null;
  statsAt: string | null;
  /** The twelve measured months, from wherever they were kept: inline
   *  on the stats row when both were bought together, or under their
   *  own key when the year was bought on its own. Empty until somebody
   *  buys it; the mounted client completes missing sections. */
  months: LiveMarketMonth[];
  /** When that year was measured, for the chart's own byline. */
  monthsAt: string | null;
  /** What is already booked ahead of today, when somebody has bought
   *  it. Empty otherwise — the page never buys it either. */
  pace: LiveMarketPace[];
  paceAt: string | null;
  /** What the earners here have that the others do not, read off the
   *  same pool the sizes are. Null when it cannot be answered fairly. */
  amenities: AmenityReading | null;
  /** Who a first unit would be bidding against here. Null when the
   *  pool is too thin, or predates the flags, to characterise. */
  competition: CompetitionReading | null;
  listingsAt: string | null;
  areas: AreaRow[];
  /** What each bedroom count earns and costs here, from the same real
   *  listings the areas are built from. */
  sizes: SizeRow[];
  /** Short-let listings this product has seen in the market, total. */
  poolSize: number;
}

/* ------------------------------------------------------------------ */
/* Headline figures                                                    */
/* ------------------------------------------------------------------ */

type Provenance = "measured" | "seen" | "estimate";

const PROVENANCE: Record<Provenance, string> = {
  measured: "Measured",
  seen: "Seen",
  estimate: "Estimate",
};

function Tile({
  label,
  value,
  provenance,
  hint,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  provenance?: Provenance;
  hint?: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 px-5 py-4">
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
        {hint ? <InfoHint label={label}>{hint}</InfoHint> : null}
      </p>
      <p className="mt-1 truncate font-display text-xl font-semibold tabular text-foreground md:text-2xl">
        {value}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
        {sub ?? (provenance ? PROVENANCE[provenance] : null)}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The year, one measure at a time                                     */
/* ------------------------------------------------------------------ */

type Trend = "adr" | "occupancy" | "revpar";

const TRENDS: { id: Trend; label: string; hint: string }[] = [
  { id: "adr", label: "Nightly rate", hint: "What a listing here charged a night, month by month." },
  { id: "occupancy", label: "Occupancy", hint: "The share of nights listings here were booked." },
  { id: "revpar", label: "RevPAR", hint: "Rate times occupancy: what a listing earned per night it was available." },
];

function showTrend(value: number, trend: Trend): string {
  return trend === "occupancy" ? `${Math.round(value)}%` : fmtMoney(value);
}

/* ------------------------------------------------------------------ */
/* The market page                                                     */
/* ------------------------------------------------------------------ */

export function MarketDetail({
  market,
  stats: initialStats,
  statsAt: initialStatsAt,
  months,
  monthsAt,
  pace,
  paceAt,
  amenities,
  competition,
  listingsAt,
  areas,
  sizes,
  poolSize,
}: Props) {
  const router = useRouter();
  const { creditsRemaining, credits, openUpgrade, refreshUsage } = useSession();
  const [sort, setSort] = React.useState<AreaSort>("revenue");
  const [trend, setTrend] = React.useState<Trend>("adr");

  /** ZIPs bought in this session, merged over what the page arrived
   *  with so a row updates without a reload. */
  const [bought, setBought] = React.useState<Record<string, MeasuredArea>>({});
  const [buying, setBuying] = React.useState<string | null>(null);

  // Opening a market automatically completes its three analysis sections.
  const wanted = initialStats === null || months.length === 0 || pace.length === 0;
  const measure = useMeasureMarket({
    slug: market.slug,
    name: market.name,
    wanted,
    onDone: () => router.refresh(),
  });
  const runMeasure = measure.run;
  React.useEffect(() => {
    runMeasure();
  }, [runMeasure]);

  const stats = measure.state.status === "done" ? measure.state.stats : initialStats;
  const statsAt = measure.state.status === "done" ? measure.state.at : initialStatsAt;
  const measuring = wanted && (measure.state.status === "idle" || measure.state.status === "measuring");

  const year = measure.state.status === "done" ? measure.state.months : months;
  const ahead = measure.state.status === "done" ? measure.state.pace : pace;
  const yearAt = measure.state.status === "done" ? measure.state.monthsAt : monthsAt;
  const aheadAt = measure.state.status === "done" ? measure.state.paceAt : paceAt;
  const analysisErrors = measure.state.status === "done" ? measure.state.errors : [];
  const sectionStatus = (label: string) => (
    <span role="status" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {measuring ? <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> : null}
      {measuring ? "Measuring " + label + "…" : "Unavailable — see analysis status above."}
    </span>
  );

  const rows = React.useMemo(
    () =>
      sortAreas(
        areas.map((a) => (bought[a.zip] ? { ...a, measured: bought[a.zip] } : a)),
        sort
      ),
    [areas, bought, sort]
  );

  const measuredCount = rows.filter((r) => r.measured).length;
  const dealsHref = `/deals?market=${market.slug}`;

  /* The market's own figures, and what stands in when it has none. */
  const adr = stats?.adr ?? null;
  const occupancy = stats?.occupancy ?? null;
  const revenue =
    stats?.revenue ??
    (adr !== null && occupancy !== null
      ? Math.round(annualRevenueFromAdr(adr, occupancy))
      : null);
  const perNight =
    stats?.revpar ??
    (adr !== null && occupancy !== null ? Math.round(revpar(adr, occupancy)) : null);
  const spread = revenue === null ? null : Math.round(revenue - market.medianRent2br * 12);

  /* How a two-bed pencils here, on the measured rate where there is
     one. The same calculator every property screen runs. */
  const pencil = React.useMemo(() => {
    if (adr === null || occupancy === null) return null;
    const inputs = benchmark2brInputs(market.medianRent2br);
    const assumptions = { adr, marketOccupancy: occupancy };
    return {
      breakeven: breakevenOccupancy(inputs, assumptions),
      cushion: marginOfSafety(inputs, assumptions),
      monthly: netCashFlow(inputs, assumptions, occupancy),
    };
  }, [adr, occupancy, market.medianRent2br]);

  const monthly = React.useMemo(
    () =>
      year.map((m) => ({
        month: m.month,
        adr: Math.round(m.adr),
        occupancy: Math.round(m.occupancy * 100),
        revpar: Math.round(m.revpar ?? revpar(m.adr, m.occupancy)),
      })),
    [year]
  );

  /**
   * The balance is checked here before the request goes out, so an
   * account with no room gets the upgrade modal rather than a refusal
   * it has to read. The server checks it again and is the actual gate:
   * this one is a courtesy, and a stale client must not be able to
   * spend anything.
   */
  const affordable = creditsRemaining + credits >= AREA_MEASURE_CREDITS;

  /** ZIPs this mount has already sent a request for. The row unmounts
   *  the moment it navigates, but a double-click can still land twice
   *  before it does, and that is one wasted call at the feed. (The
   *  charge itself is keyed per ZIP on the server and cannot double.) */
  const sent = React.useRef(new Set<string>());

  /**
   * Buy one ZIP's real figures.
   *
   * Not awaited by the row click: a client navigation keeps this same
   * JS context alive, so the request finishes, the toast lands on
   * whatever screen the reader is on by then, and the figure is on file
   * for the next time the market is opened. `keepalive` covers the one
   * case a client navigation does not — a reload or a closed tab mid
   * flight — so a measure that was paid for is never thrown away.
   */
  const measureArea = async (row: AreaRow) => {
    if (sent.current.has(row.zip)) return;
    sent.current.add(row.zip);
    setBuying(row.zip);
    try {
      const res = await fetch("/api/markets/area", {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          market: market.slug,
          zip: row.zip,
          lat: row.lat,
          lon: row.lon,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            stats?: MeasuredArea;
            message?: string;
            reason?: string;
            charged?: number;
          }
        | null;
      if (res.status === 402 || data?.reason === "no-credits") {
        openUpgrade({ reason: "credits" });
        return;
      }
      if (!res.ok || !data?.ok || !data.stats) {
        toast.error(data?.message ?? "Those figures could not be fetched.");
        return;
      }
      setBought((prev) => ({ ...prev, [row.zip]: data.stats as MeasuredArea }));
      const charged = data.charged ?? 0;
      // What it cost, and nothing else. A toast is not the place to
      // explain how the store works.
      // The title and nothing else. What it cost was on the row before
      // the click; saying it again afterwards is a meter reading, not
      // news, and the balance in the header is already the truth.
      toast.success(`${row.zip} measured`);
      // The meter in the header spent something; settle it from the
      // server rather than guessing at the new number here.
      if (charged > 0) void refreshUsage();
    } catch {
      toast.error("Those figures could not be fetched.");
    } finally {
      setBuying(null);
    }
  };

  /**
   * WHAT A ROW CLICK IS.
   *
   * Opening an area is asking two questions at once — what is let here,
   * and what does it earn — so the click answers both: the ZIP opens in
   * the Deal Finder, which searches it on arrival off `?zip=`, and the
   * measure goes out in the same gesture. Same price as the button it
   * replaces, and a ZIP already on file opens free, forever and for
   * everybody.
   *
   * The navigation does not wait on the feed. A reader who has just
   * clicked a row wants the rentals, not a spinner, and the figure
   * catches up under them.
   */
  const openArea = (row: AreaRow) => {
    const owed = !row.measured && !sent.current.has(row.zip);
    if (owed && !affordable) {
      // Nothing is spent and nothing is opened: the click promised a
      // measure. The row's own Rentals link is still the free way in.
      openUpgrade({ reason: "credits" });
      return;
    }
    if (owed) void measureArea(row);
    router.push(`/deals?zip=${row.zip}`);
  };

  /**
   * The forward book, month by month, with last year's FINISHED
   * occupancy beside it.
   *
   * Beside, never subtracted. "October is 34% booked" is a month still
   * filling, read at whatever lead time today happens to be; "October
   * finished at 71%" is a month that is over. A difference between them
   * is mostly just the calendar, so the chart puts both up and labels
   * each for what it is rather than inventing a verdict.
   */
  const paceRows = React.useMemo(() => {
    const finished = lastYearByMonth(
      year.map((m) => ({ month: m.month, occupancy: m.occupancy }))
    );
    return paceMonths(ahead).map((m) => {
      const prior = finished.get(m.month.slice(5, 7));
      return {
        month: m.month,
        booked: Math.round(m.booked * 100),
        lastYear: prior === undefined ? null : Math.round(prior * 100),
      };
    });
  }, [ahead, year]);

  const amenityColumns = React.useMemo<DataTableColumn<AmenityRow>[]>(
    () => [
      {
        key: "amenity",
        header: "Amenity",
        cell: (r) => (
          <span className="truncate font-medium capitalize text-foreground">
            {r.amenity}
          </span>
        ),
        className: "w-full min-w-32 max-w-0",
      },
      {
        key: "lift",
        header: "Gap",
        align: "right",
        cell: (r) => {
          const flat = Math.abs(r.lift) < 0.02;
          return (
            <span
              className={
                flat ? "text-muted-foreground" : r.lift > 0 ? "text-gold" : "text-neg"
              }
            >
              {flat
                ? "Even"
                : `${r.lift > 0 ? "+" : "−"}${fmtPct(Math.abs(r.lift))}`}
            </span>
          );
        },
      },
      {
        key: "with",
        header: "With",
        align: "right",
        cell: (r) => (
          <span className="text-foreground">{fmtMoneyShort(r.withRevenue)}</span>
        ),
      },
      {
        key: "without",
        header: "Without",
        align: "right",
        cell: (r) => (
          <span className="text-muted-foreground">
            {fmtMoneyShort(r.withoutRevenue)}
          </span>
        ),
      },
      {
        // The sample, on every row. A gap read off six listings and one
        // read off sixty look identical without it.
        key: "n",
        header: "Listings",
        align: "right",
        cell: (r) => (
          <span className="text-muted-foreground">
            {fmtNum(r.withCount)} / {fmtNum(r.withoutCount)}
          </span>
        ),
      },
    ],
    []
  );

  const fine = useFinePointer();
  const field = competition ? fieldOf(competition) : null;

  const best = React.useMemo(() => bestSize(sizes), [sizes]);
  /** Sizes that have a rate, which is to say sizes somebody has run an
   *  analysis on here. The rest carry a lease and nothing else. */
  const sized = React.useMemo(() => sizes.filter((r) => r.adr !== null), [sizes]);

  const sizeColumns = React.useMemo<DataTableColumn<SizeRow>[]>(
    () => [
      {
        key: "size",
        header: "Size",
        cell: (r) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="font-sans font-medium text-foreground">{r.label}</span>
            {best && r.bedrooms === best.bedrooms ? (
              <StatusChip tone="gold">Widest</StatusChip>
            ) : null}
          </span>
        ),
        className: "w-full min-w-28 max-w-0",
      },
      {
        key: "seen",
        header: (
          <span className="inline-flex items-center gap-1">
            Listings seen
            <InfoHint label="listings seen" side="bottom">
              Real short-let listings this product has pulled at this size, from
              every analysis anybody has run in {market.name}. An analysis buys
              the comps that match its own property&apos;s size, so a size
              nobody has analyzed here has none — which is why a row can show a
              lease and no rate.
            </InfoHint>
          </span>
        ),
        align: "right",
        cell: (r) =>
          r.comps > 0 ? (
            <span className="text-muted-foreground">{fmtNum(r.comps)}</span>
          ) : (
            <span className="text-[11px] text-muted-foreground/60">None yet</span>
          ),
        className: "min-w-32",
      },
      {
        key: "adr",
        header: "Nightly",
        align: "right",
        cell: (r) => (r.adr === null ? NONE : fmtMoney(r.adr)),
      },
      {
        key: "occ",
        header: "Occupancy",
        align: "right",
        cell: (r) => (r.occupancy === null ? NONE : fmtPct(r.occupancy)),
      },
      {
        key: "rev",
        header: "Revenue/yr",
        align: "right",
        cell: (r) => (r.revenue === null ? NONE : fmtMoneyShort(r.revenue)),
      },
      {
        key: "rent",
        header: "Asking rent",
        align: "right",
        cell: (r) =>
          r.rent === null ? (
            NONE
          ) : (
            <span className="text-muted-foreground">{fmtMoney(r.rent)}</span>
          ),
      },
      {
        key: "spread",
        header: "Spread/yr",
        align: "right",
        cell: (r) =>
          r.spread === null ? (
            NONE
          ) : (
            <span className={r.spread >= 0 ? "text-gold" : "text-neg"}>
              {r.spread < 0 ? "−" : ""}
              {fmtMoneyShort(Math.abs(r.spread))}
            </span>
          ),
      },
    ],
    [best, market.name]
  );

  const columns = React.useMemo<DataTableColumn<AreaRow>[]>(
    () => [
      {
        key: "zip",
        header: "Area",
        cell: (r) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-sans font-medium tabular text-foreground">
                {r.zip}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {r.town ?? market.name}
                {r.measured ? " · measured" : null}
              </span>
            </span>
            {/* The row goes somewhere and nothing said so but the
                cursor. Not a button: the row itself is the target, and
                a control inside a clickable row is two targets where
                somebody expects one. */}
            {/* Always there on a touch screen: a finger cannot hover,
                and this row spends credits. It used to be hidden below
                the small breakpoint, so a phone showed an ordinary-
                looking row that charged on tap. */}
            <span
              aria-hidden
              className={cn(
                "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold text-white shadow-[0_4px_12px_rgba(196,30,46,0.3)] transition-all duration-150 ease-out grad-brand",
                fine
                  ? "-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
                  : "opacity-100"
              )}
            >
              {r.measured
                ? actionLabel(fine, "open rentals")
                : `${actionLabel(fine, "Measure")} · ${PRICE}`}
              <ArrowRight className="size-3" />
            </span>
          </span>
        ),
        className: "w-full min-w-32 max-w-0",
      },
      {
        key: "listings",
        header: "Listings",
        align: "right",
        cell: (r) =>
          r.measured?.activeListings != null ? (
            <span className="text-foreground">{fmtNum(r.measured.activeListings)}</span>
          ) : r.comps > 0 ? (
            <span className="text-muted-foreground">{fmtNum(r.comps)} seen</span>
          ) : (
            NONE
          ),
      },
      {
        key: "revenue",
        header: "Revenue/yr",
        align: "right",
        cell: (r) => {
          const v = r.measured?.revenue ?? r.revenue;
          return v === null ? NONE : fmtMoneyShort(v);
        },
      },
      {
        key: "adr",
        header: "Nightly",
        align: "right",
        cell: (r) => {
          const v = r.measured?.adr ?? r.adr;
          return v === null ? NONE : fmtMoney(v);
        },
      },
      {
        key: "occupancy",
        header: "Occupancy",
        align: "right",
        cell: (r) => {
          const v = r.measured?.occupancy ?? r.occupancy;
          return v === null ? NONE : fmtPct(v);
        },
      },
      {
        key: "vs",
        header: "vs market",
        align: "right",
        cell: (r) => {
          const v = versusMarket(r.measured?.revenue ?? r.revenue, revenue);
          if (v === null) return NONE;
          const flat = Math.abs(v) < 0.005;
          return (
            <span className={flat ? "text-muted-foreground" : v > 0 ? "text-gold" : "text-neg"}>
              {flat ? "Even" : `${v > 0 ? "+" : "−"}${fmtPct(Math.abs(v))}`}
            </span>
          );
        },
      },
      {
        key: "rent",
        header: "Asking rent",
        align: "right",
        cell: (r) =>
          r.medianRent === null ? (
            NONE
          ) : (
            <span className="text-muted-foreground">{fmtMoney(r.medianRent)}</span>
          ),
      },
      {
        key: "act",
        header: "",
        align: "right",
        cell: (r) => (
          <span className="flex items-center justify-end gap-1">
            {buying === r.zip ? (
              <span className="inline-flex items-center gap-1.5 pr-2 text-[11px] text-muted-foreground">
                <Loader2 aria-hidden className="size-3 animate-spin" />
                Measuring
              </span>
            ) : r.measured ? null : (
              // What the row costs, on every screen — the hover pill
              // above never appears on a phone, and a price nobody saw
              // before the tap is not a price.
              <span className="pr-1 text-[11px] text-muted-foreground">{PRICE}</span>
            )}
            {/* The free way in, for a reader who wants the rentals and
                not the measure. Stops the click so the row's own
                handler does not spend on their behalf. */}
            <Button asChild variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]">
              <Link href={`/deals?zip=${r.zip}`} onClick={(e) => e.stopPropagation()}>
                Rentals
                <ArrowUpRight aria-hidden className="size-3" />
              </Link>
            </Button>
          </span>
        ),
        className: "min-w-40",
      },
    ],
    [buying, fine, market.name, revenue]
  );

  return (
    <div className="px-4 py-7 md:px-6 lg:px-8">
      <Link
        href="/markets"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        All markets
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            {market.name}, {market.stateCode}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin aria-hidden className="size-3" />
              {TERRAIN_LABEL[market.terrain]}
            </span>
            <span aria-hidden>·</span>
            <StatusChip tone={RULE_TONE[market.regulation.status]}>
              {RULE_LABEL[market.regulation.status]}
            </StatusChip>
            <span className="max-w-xl">{market.regulation.note}</span>
            <InfoHint label="the local rule">
              {market.regulation.sourceNote}
            </InfoHint>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <SaveMarketButton slug={market.slug} name={market.name} />
          <Button asChild variant="brand" size="sm" className="gap-1.5">
            <Link href={dealsHref}>
              <Binoculars aria-hidden className="size-3.5" />
              Open in Deal Finder
            </Link>
          </Button>
        </div>
      </header>

      {measuring ? <MarketMeasuring name={market.name} /> : null}
      {measure.state.status === "failed" || measure.state.status === "no-credits" || analysisErrors.length > 0 ? (
        <section role="alert" className="mt-5 rounded-sm border border-border bg-card px-5 py-4 text-sm elev-card">
          {measure.state.status === "no-credits" ? (
            <p>Not enough credits to complete this analysis. A new market costs {MEASURE_PRICE}; cached sections stay free.</p>
          ) : measure.state.status === "failed" ? (
            <p>{measure.state.message}</p>
          ) : analysisErrors.map((error) => <p key={error.section}>{error.message}</p>)}
          <Button size="sm" className="mt-3" onClick={() => measure.state.status === "no-credits"
            ? openUpgrade({ reason: "credits" }) : window.location.reload()}>
            {measure.state.status === "no-credits" ? "Plans & packs" : "Retry missing figures"}
          </Button>
        </section>
      ) : null}

      {/* The headline four, as a single band rather than four cards:
          they are one reading of one market, and four boxes read as
          four unrelated facts. */}
      <section aria-busy={measuring} className="mt-6 overflow-hidden rounded-sm border border-border bg-card elev-card">
        <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 [&>*+*]:border-border sm:[&>*+*]:border-l">
          <Tile
            label="Revenue / yr"
            value={revenue === null ? NONE : fmtMoneyShort(revenue)}
            provenance="measured"
            hint={HINTS.grossRevenue}
            sub={revenue === null ? "Not measured yet" : PROVENANCE.measured}
          />
          <Tile
            label="Occupancy"
            value={occupancy === null ? NONE : fmtPct(occupancy)}
            provenance="measured"
            hint={HINTS.occupancy}
            sub={occupancy === null ? "Not measured yet" : PROVENANCE.measured}
          />
          <Tile
            label="Nightly rate"
            value={adr === null ? NONE : fmtMoney(adr)}
            provenance="measured"
            hint={HINTS.adr}
            sub={adr === null ? "Not measured yet" : PROVENANCE.measured}
          />
          <Tile
            label="Active listings"
            value={
              stats?.activeListings == null ? NONE : fmtNum(stats.activeListings)
            }
            hint="Short-let listings the data provider counted in this market. It is a count of the whole city, not of what this product has happened to see."
            sub={
              stats?.activeListings == null
                ? "Not measured yet"
                : stats.scope === "zip"
                  ? "Measured · ZIP scope"
                  : PROVENANCE.measured
            }
          />
        </div>
        <div className="grid divide-y divide-border border-t border-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 [&>*+*]:border-border sm:[&>*+*]:border-l">
          <Tile
            label="RevPAR"
            value={perNight === null ? NONE : fmtMoney(perNight)}
            provenance="measured"
            hint={HINTS.revpar}
            sub={perNight === null ? "Not measured yet" : PROVENANCE.measured}
          />
          <Tile
            label="2BR asking rent"
            value={fmtMoney(market.medianRent2br)}
            provenance="estimate"
            hint="A researched median asking lease for a two-bedroom here — a bracket to underwrite against, not a quote on any unit. Open the Deal Finder for what is actually listed today."
          />
          <Tile
            label="Spread / yr"
            value={
              spread === null ? (
                NONE
              ) : (
                <span className={spread >= 0 ? "text-gold" : "text-neg"}>
                  {spread < 0 ? "−" : ""}
                  {fmtMoneyShort(Math.abs(spread))}
                </span>
              )
            }
            hint="A year of measured letting revenue less a year of the estimated lease. Part measured and part estimate, so read it as a bracket."
            sub={spread === null ? "Needs measured revenue" : "Measured less estimate"}
          />
          <Tile
            label="Listings seen"
            value={poolSize === 0 ? NONE : fmtNum(poolSize)}
            hint="Real short-let listings this product has pulled in this market, from every analysis anybody has run here. It is a sample that grows with use — never the whole supply."
            sub={poolSize === 0 ? "Nothing analyzed here yet" : "Sample · grows with use"}
          />
        </div>
        {statsAt ? (
          <p className="border-t border-border bg-secondary/40 px-5 py-2 text-[11px] text-muted-foreground">
            Market figures measured {fmtWhen(statsAt)}
            {listingsAt ? ` · rentals last pulled ${fmtWhen(listingsAt)}` : null}
          </p>
        ) : (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border bg-secondary/40 px-5 py-2 text-[11px] text-muted-foreground">
            {measure.state.status === "measuring" ? (
              <>
                <Loader2 aria-hidden className="size-3 animate-spin" />
                Measuring {market.name}…
              </>
            ) : measure.state.status === "no-credits" ? (
              <>
                <span>
                  Not enough credits to complete the market analysis.
                </span>
                <button
                  type="button"
                  onClick={() => openUpgrade({ reason: "credits" })}
                  className="font-medium text-gold underline-offset-2 hover:underline"
                >
                  Plans &amp; packs
                </button>
              </>
            ) : measure.state.status === "failed" ? (
              <span>
                {measure.state.message} Reload to check again.
              </span>
            ) : (
              <span>Measuring this market costs {MEASURE_PRICE}.</span>
            )}
          </p>
        )}
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        {/* What size to lease — the question a market is actually
            opened with, answered entirely from listings already on
            hand. Nothing here costs a call. */}
        <section className="min-w-0 overflow-hidden rounded-sm border border-border bg-card elev-card">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              What size to lease
              <InfoHint label="the size table">
                The middle nightly rate and occupancy of the short-let listings
                this product has seen at each size, against the middle asking
                lease of the rentals listed at that size. Both sides are real
                listings and both are samples that grow as the market gets
                worked — never the whole supply.
              </InfoHint>
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {best ? (
                <>
                  {best.label} clears the widest spread here —{" "}
                  {fmtMoneyShort(best.spread ?? 0)} a year over a{" "}
                  {fmtMoney(best.rent ?? 0)} lease
                  {sized.length === 1
                    ? ", and it is the only size analyzed here so far"
                    : ` of the ${sized.length} sizes analyzed here`}
                  .
                </>
              ) : (
                `Rates need ${MIN_COMPS} short-let listings seen and a lease needs ${MIN_RENTALS} rentals before a size can be read.`
              )}
            </p>
          </div>
          <DataTable
            columns={sizeColumns}
            rows={sizes}
            rowKey={(r) => String(r.bedrooms)}
            rowClassName={(r) =>
              best && r.bedrooms === best.bedrooms ? "bg-gold-fill/[0.07]" : undefined
            }
            emptyState={
              <EmptyState
                icon={Ruler}
                title="Nothing to compare yet"
                description="Sizes are read from real listings — the short-let comps analyses leave behind and the rentals a search brings in."
                action={
                  <Button asChild variant="outline" size="sm">
                    <Link href={dealsHref}>
                      Search {market.name} in the Deal Finder
                      <ArrowUpRight aria-hidden className="size-3.5" />
                    </Link>
                  </Button>
                }
              />
            }
          />
          <p className="flex flex-wrap items-center gap-x-1.5 border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
            <span>
              Spread is a year at the rate seen, less a year of the lease
              listed — the size comparison, not a quote on any unit.
            </span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1.5">
              a size fills in when somebody analyzes one
              <InfoHint label="why a size is empty">
                The asking lease comes from every rental listed here, so it
                shows at every size. The rate does not: an analysis buys the
                short-let listings that match its own property&apos;s size, so
                a size arrives the first time anybody runs a property of that
                size in {market.name}.
              </InfoHint>
            </span>
          </p>
        </section>

        {/* What those figures mean for the unit this product is about. */}
        <aside className="min-w-0 overflow-hidden rounded-sm border border-border bg-card elev-card">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold text-foreground">
              How a two-bed pencils
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              The measured rate against the estimated lease, on this
              product&apos;s standard assumptions.
            </p>
          </div>
          {pencil ? (
            <dl className="divide-y divide-border">
              <Row
                label="Breakeven occupancy"
                hint={HINTS.breakeven}
                value={fmtPct(pencil.breakeven)}
              />
              <Row
                label="Cushion"
                hint={HINTS.cushion}
                value={
                  <span className={pencil.cushion < 0 ? "text-neg" : "text-gold"}>
                    {pencil.cushion < 0 ? "−" : "+"}
                    {Math.abs(Math.round(pencil.cushion * 100))} pts
                  </span>
                }
              />
              <Row
                label="Net cash flow / mo"
                hint={HINTS.netCashFlow}
                value={
                  <span className={pencil.monthly < 0 ? "text-neg" : "text-foreground"}>
                    {pencil.monthly < 0 ? "−" : ""}
                    {fmtMoney(Math.abs(Math.round(pencil.monthly)))}
                  </span>
                }
              />
              <Row label="Against a lease of" value={fmtMoney(market.medianRent2br)} />
            </dl>
          ) : (
            <p className="px-5 py-6 text-xs text-muted-foreground">
              This needs the market&apos;s measured rate and occupancy. Run an
              analysis on a property here.
            </p>
          )}
          <div className="border-t border-border px-5 py-3">
            <Button asChild variant="outline" size="sm" className="w-full gap-1.5">
              <Link href={dealsHref}>
                Rentals in {market.name}
                <ArrowUpRight aria-hidden className="size-3.5" />
              </Link>
            </Button>
          </div>
        </aside>
      </div>

      {/* One metric per axis; the chips switch the measure. */}
      <section className="mt-5 overflow-hidden rounded-sm border border-border bg-card elev-card">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              Through the year
              <InfoHint label="the year">
                A lease runs twelve months. Revenue does not arrive in
                twelve equal pieces, and an annual average cannot tell a
                market that earns evenly from one that earns most of its
                year in a season — which is the difference between a
                lease that carries itself and one that does not. This is
                the twelve measured months behind the average.
              </InfoHint>
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {monthly.length > 0
                ? `Twelve measured months in ${market.name}${yearAt ? ` · ${fmtWhen(yearAt)}` : ""}.`
                : "Rate, occupancy and revenue month by month — what the average is made of."}
            </p>
          </div>
          {monthly.length > 0 ? (
            <div className="-mx-1 -my-1 flex gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {TRENDS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={trend === t.id}
                  title={t.hint}
                  onClick={() => setTrend(t.id)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors duration-150",
                    trend === t.id
                      ? "border-transparent bg-select text-white grad-brand shadow-[0_2px_8px_rgba(196,30,46,0.28)]"
                      : "border-border bg-card text-muted-foreground hover:border-select/50 hover:bg-hover hover:text-foreground"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : (
            sectionStatus("the year")
          )}
        </div>
        {monthly.length > 0 ? (
          <div className="px-2 pb-4 pt-5">
            <ResponsiveContainer width="100%" height={252}>
              <AreaChart data={monthly} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis
                  {...AXIS_PROPS}
                  dataKey="month"
                  tickFormatter={(m: string) => fmtMonth(m)}
                  interval="preserveStartEnd"
                />
                <YAxis
                  {...AXIS_PROPS}
                  width={52}
                  domain={trend === "occupancy" ? [0, 100] : [0, "auto"]}
                  tickFormatter={(v: number) => showTrend(v, trend)}
                />
                <Tooltip
                  cursor={{ stroke: CHART.grid }}
                  content={asTooltipContent(
                    makeTooltip(
                      (value) => showTrend(value, trend),
                      (label) => fmtMonth(String(label))
                    )
                  )}
                />
                <Area
                  type="monotone"
                  dataKey={trend}
                  name={TRENDS.find((t) => t.id === trend)?.label ?? ""}
                  stroke={CHART.primary}
                  strokeWidth={2}
                  fill={CHART.areaFill}
                  fillOpacity={CHART.areaFillOpacity}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: CHART.primary }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </section>

      {/* What is already reserved, ahead of today. */}
      <section className="mt-5 overflow-hidden rounded-sm border border-border bg-card elev-card">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              Booked ahead
              <InfoHint label="booked ahead">
                The share of each coming month that is already reserved
                across this market, read off the calendars on sale today.
                Every other figure on this page is trailing — it says what
                the market did. This is the only one that can catch a
                market that has just turned while its year still looks
                healthy. It is not last year&apos;s occupancy and is never
                subtracted from it: a coming month is still filling, and a
                finished one is not.
              </InfoHint>
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {paceRows.length > 0
                ? `Already reserved in ${market.name}${aheadAt ? ` · ${fmtWhen(aheadAt)}` : ""}.`
                : "How much of each coming month is already reserved here."}
            </p>
          </div>
          {paceRows.length > 0 ? null : (
            sectionStatus("booked ahead")
          )}
        </div>
        {paceRows.length > 0 ? (
          <div className="px-2 pb-4 pt-5">
            <ResponsiveContainer width="100%" height={252}>
              <BarChart data={paceRows} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis
                  {...AXIS_PROPS}
                  dataKey="month"
                  tickFormatter={(m: string) => fmtMonth(m)}
                  interval="preserveStartEnd"
                />
                <YAxis
                  {...AXIS_PROPS}
                  width={44}
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  cursor={{ fill: "var(--hover)" }}
                  content={asTooltipContent(
                    makeTooltip(
                      (value) => `${Math.round(value)}%`,
                      (label) => fmtMonth(String(label))
                    )
                  )}
                />
                <Legend
                  verticalAlign="top"
                  height={28}
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11, color: "var(--text-muted)" }}
                />
                <Bar
                  dataKey="booked"
                  name="Booked so far"
                  fill={CHART.primary}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
                {/* Only drawn when the year is on file. Its own series,
                    its own name: this month is over and that one is not. */}
                {paceRows.some((r) => r.lastYear !== null) ? (
                  <Bar
                    dataKey="lastYear"
                    name="Finished last year"
                    fill={CHART.comparison}
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                ) : null}
              </BarChart>
            </ResponsiveContainer>
            {year.length === 0 ? (
              <p className="px-3 pt-1 text-[11px] text-muted-foreground">
                Measure the year above to see what these months finished at
                last time.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* What the earners have. Free: it is read off the same pool the
          sizes are, which every analysis anybody runs adds to. */}
      {amenities ? (
        <section className="mt-5 overflow-hidden rounded-sm border border-border bg-card elev-card">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              What the earners have
              <InfoHint label="what the earners have">
                The building is somebody else&apos;s; the furnishing is
                yours, which makes this the one lever on the page you
                actually pull. Each row compares {bandLabel(amenities.bedrooms).toLowerCase()}{" "}
                listings here that advertise the thing against{" "}
                {bandLabel(amenities.bedrooms).toLowerCase()} listings here that
                do not — same size on both sides, so a hot tub cannot take
                credit for being on a bigger house. It is a gap between two
                groups, not a promise that fitting one moves your number.
              </InfoHint>
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {bandLabel(amenities.bedrooms)} listings seen in {market.name} ·{" "}
              {fmtNum(amenities.sample)} compared
            </p>
          </div>
          <DataTable
            columns={amenityColumns}
            rows={amenities.rows}
            rowKey={(r) => r.amenity}
          />
        </section>
      ) : null}

      {/* Who a first unit would be bidding against. Free, off the same
          pool — and expectation-setting, never a grade. */}
      {competition ? (
        <section className="mt-5 overflow-hidden rounded-sm border border-border bg-card elev-card">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              Who you&apos;re up against
              <InfoHint label="who you&apos;re up against">
                Every revenue figure on this page is what the listings
                here achieve. Who achieves it matters: a market run by
                management companies hits its median with dynamic
                pricing, cleaning crews and round-the-clock guest
                response. The figures are real either way — this says
                what they are likely to mean for one unit and one
                operator. It is not a verdict on the market.
              </InfoHint>
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Of the short-let listings seen in {market.name}
            </p>
          </div>
          <div className="grid gap-px bg-border sm:grid-cols-2">
            <div className="bg-card px-5 py-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Professionally run
              </p>
              <p className="mt-1 font-display text-xl font-semibold tabular text-foreground md:text-2xl">
                {fmtPct(competition.managed)}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                of {fmtNum(competition.managedOf)} that said
              </p>
            </div>
            <div className="bg-card px-5 py-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Badged hosts
              </p>
              <p className="mt-1 font-display text-xl font-semibold tabular text-foreground md:text-2xl">
                {fmtPct(competition.badged)}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                of {fmtNum(competition.badgedOf)} that said
              </p>
            </div>
          </div>
          {field ? (
            <p className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
              {FIELD_NOTE[field]}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* The areas. */}
      <section className="mt-5 overflow-hidden rounded-sm border border-border bg-card elev-card">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              Areas inside {market.name}
              <InfoHint label="the areas">
                Every ZIP this product holds real rentals in, with the middle
                figures of the short-let listings seen in it. A ZIP is a real
                boundary and the one the data provider answers at, which is why
                these are ZIPs rather than neighbourhood names. Opening a row
                searches its rentals and buys that ZIP&apos;s own figures,
                including a true count of its listings.
              </InfoHint>
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {rows.length === 0
                ? "None yet."
                : `${fmtNum(rows.length)} ${rows.length === 1 ? "area" : "areas"}, ${fmtNum(measuredCount)} measured. Rates need ${MIN_COMPS} listings seen before they show.`}
            </p>
          </div>
          <div className="-mx-1 -my-1 flex gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {AREA_SORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={sort === s.id}
                title={s.hint}
                onClick={() => setSort(s.id)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors duration-150",
                  sort === s.id
                    ? "border-transparent bg-select text-white grad-brand shadow-[0_2px_8px_rgba(196,30,46,0.28)]"
                    : "border-border bg-card text-muted-foreground hover:border-select/50 hover:bg-hover hover:text-foreground"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.zip}
          onRowClick={openArea}
          // `group` is what the row's pill hangs its hover off. Without
          // it the pill was invisible on a cursor and hidden on a
          // phone, which is to say it never appeared anywhere.
          rowClassName={() => "group"}
          emptyState={
            <EmptyState
              icon={Search}
              title="No areas in this market yet"
              description="Areas are built from real rentals and real short-let listings."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href={dealsHref}>
                    Search {market.name} in the Deal Finder
                    <ArrowUpRight aria-hidden className="size-3.5" />
                  </Link>
                </Button>
              }
            />
          }
        />
        <p className="flex flex-wrap items-center gap-x-1.5 border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            A seen count is a sample, not the supply
            <InfoHint label="a seen count">
              It is how many real short-let listings this product has pulled in
              that ZIP across every analysis anybody has run. The true count of
              what is listed there comes from measuring the row.
            </InfoHint>
          </span>
          <span aria-hidden>·</span>
          <span>asking rent is the median of the rentals listed there</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1.5">
            measuring an area costs {PRICE}
            <InfoHint label="what measuring costs">
              It buys that ZIP&apos;s own figures from the data provider,
              including how many short-let listings are really in it.
            </InfoHint>
          </span>
        </p>
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {hint ? <InfoHint label={label}>{hint}</InfoHint> : null}
      </dt>
      <dd className="text-sm font-semibold tabular text-foreground">{value}</dd>
    </div>
  );
}
