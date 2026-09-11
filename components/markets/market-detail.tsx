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
  ArrowUpRight,
  Binoculars,
  Loader2,
  MapPin,
  Ruler,
  Search,
  Sparkles,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
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
import { AREA_MEASURE_CREDITS } from "@/config/app";
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
import { benchmark2brInputs } from "@/lib/mock/markets";
import type { Market } from "@/lib/mock/types";
import type { StoredMarketStats } from "@/lib/db/market-store";
import type { LiveMarketMonth } from "@/lib/live/airroi";
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
import { useSession } from "@/components/providers/session-provider";
import { MEASURE_PRICE, MeasureMarketButton } from "./measure-market-button";
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
   *  own key when the year was bought on its own. */
  months: LiveMarketMonth[];
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
  stats,
  statsAt,
  months,
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
      months.map((m) => ({
        month: m.month,
        adr: Math.round(m.adr),
        occupancy: Math.round(m.occupancy * 100),
        revpar: Math.round(m.revpar ?? revpar(m.adr, m.occupancy)),
      })),
    [months]
  );

  /**
   * Buy one ZIP's real figures.
   *
   * The balance is checked here before the request goes out, so an
   * account with no room gets the upgrade modal rather than a refusal
   * it has to read. The server checks it again and is the actual gate:
   * this one is a courtesy, and a stale client must not be able to
   * spend anything.
   */
  const affordable = creditsRemaining + credits >= AREA_MEASURE_CREDITS;

  const measureArea = async (row: AreaRow) => {
    if (!affordable) {
      openUpgrade({ reason: "credits" });
      return;
    }
    setBuying(row.zip);
    try {
      const res = await fetch("/api/markets/area", {
        method: "POST",
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
      toast.success(`${row.zip} measured`, {
        description:
          charged > 0
            ? `${charged} ${charged === 1 ? "credit" : "credits"}`
            : "No credits taken",
      });
      // The meter in the header spent something; settle it from the
      // server rather than guessing at the new number here.
      if (charged > 0) void refreshUsage();
    } catch {
      toast.error("Those figures could not be fetched.");
    } finally {
      setBuying(null);
    }
  };

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
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-sans font-medium tabular text-foreground">
              {r.zip}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {r.town ?? market.name}
              {r.measured ? " · measured" : null}
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
            {r.measured ? null : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={buying !== null}
                title={`Measure ${r.zip} — ${PRICE}`}
                aria-label={`Measure ${r.zip}, ${PRICE}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void measureArea(r);
                }}
                className="h-7 gap-1 px-2 text-[11px]"
              >
                {buying === r.zip ? (
                  <Loader2 aria-hidden className="size-3 animate-spin" />
                ) : (
                  <Sparkles aria-hidden className="size-3" />
                )}
                Measure
              </Button>
            )}
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
    // measureArea closes over `buying` and `market.slug`; both are in
    // the list that rebuilds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [affordable, buying, market.name, market.slug, revenue]
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
          {/* The gap, with the way to close it beside it. A market with
              figures needs no button; one without had no way at all to
              ask for them from the page that shows the dashes. */}
          {stats ? null : (
            <MeasureMarketButton
              slug={market.slug}
              name={market.name}
              variant="outline"
              onMeasured={() => router.refresh()}
            />
          )}
          <SaveMarketButton slug={market.slug} name={market.name} />
          <Button asChild size="sm" className="gap-1.5">
            <Link href={dealsHref}>
              <Binoculars aria-hidden className="size-3.5" />
              Open in Deal Finder
            </Link>
          </Button>
        </div>
      </header>

      {/* The headline four, as a single band rather than four cards:
          they are one reading of one market, and four boxes read as
          four unrelated facts. */}
      <section className="mt-6 overflow-hidden rounded-sm border border-border bg-card elev-card">
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
          <p className="border-t border-border bg-secondary/40 px-5 py-2 text-[11px] text-muted-foreground">
            No measured figures for this market yet — measure it for{" "}
            {MEASURE_PRICE}, or run an analysis on a property here.
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
                description={`Sizes are read from real listings — the short-let comps analyses leave behind and the rentals a search brings in. Search ${market.name} in the Deal Finder and run an analysis, and this fills in for everybody.`}
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
              analysis on a property here and they arrive for everybody.
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

      {/* Seasonality, ONLY where the stats row already carries twelve
          months — a market measured at the full setting. The series is
          a separate billed call and this page does not make it, so a
          market without one shows no chart rather than an empty box
          asking to be paid for.

          ONE SERIES, ONE AXIS. A rate and an occupancy on the same
          picture needs two y-scales, and two y-scales let a reader see
          a crossing that is an artefact of where the axes were put.
          The chips switch the measure instead. */}
      {monthly.length > 0 ? (
        <section className="mt-5 overflow-hidden rounded-sm border border-border bg-card elev-card">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-5 py-3.5">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">
                Through the year
              </h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Twelve measured months in {market.name}.
              </p>
            </div>
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
          </div>
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
                these are ZIPs rather than neighbourhood names. Measure a row to
                buy that ZIP&apos;s own figures, including a true count of its
                listings.
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
          emptyState={
            <EmptyState
              icon={Search}
              title="No areas in this market yet"
              description="Areas are built from real rentals and real short-let listings. Search this market in the Deal Finder and run an analysis, and its ZIPs appear here for everybody."
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
              including how many short-let listings are really in it. An area
              already measured costs nothing to read.
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
