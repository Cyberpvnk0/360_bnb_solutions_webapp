"use client";

/**
 * The market table, and the line between what was measured and what
 * was not.
 *
 * Four hundred US markets, every one of them carrying where it is,
 * what kind of place it is and what the local rule on nightly letting
 * says — the three things the catalogue was researched for. The
 * performance columns carry only what a vendor actually measured, for
 * the markets somebody's analysis has already paid for, and a dash
 * everywhere else. The band above says how many that is, so the gaps
 * read as coverage rather than as a broken table.
 *
 * Measured first is the default order, because a table sorted by name
 * opens on three hundred blanks. Sorting by any figure puts the
 * unmeasured last rather than at zero, for the same reason.
 *
 * A row opens that market: its areas, its measured year, and the way
 * through to the rentals listed in it.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, FileDown, Map as MapIcon, Search, X } from "lucide-react";
import { toast } from "sonner";
import { csvFileName, downloadCsv, toCsv, type CsvColumn } from "@/lib/export/csv";
import { fmtMoney, fmtMoneyShort, fmtNum, fmtPct } from "@/lib/format";
import {
  EMPTY_QUERY,
  filterMarkets,
  isFiltered,
  RULE_LABEL,
  RULE_ORDER,
  RULE_TONE,
  sortMarkets,
  TERRAIN_LABEL,
  TERRAIN_ORDER,
  type MarketQuery,
  type MarketRow,
  type MarketSort,
} from "@/lib/markets/explorer";
import type { MarketTerrain, RegulationStatus } from "@/lib/mock/types";
import { MarketsMap } from "./markets-map";
import { SaveMarketButton } from "./save-market-button";
import { DataTable, type DataTableColumn } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { InfoHint } from "@/components/primitives/info-hint";
import { StatusChip } from "@/components/primitives/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** A figure the vendor did not measure. Never a zero. */
const NONE = <span className="text-muted-foreground/60">—</span>;

const PRESETS: { id: MarketSort; label: string; hint: string }[] = [
  { id: "measured", label: "Measured first", hint: "Markets the platform holds figures for, biggest year first." },
  { id: "revenue", label: "Highest revenue", hint: "What a typical listing earned there over the last twelve months." },
  { id: "spread", label: "Widest spread", hint: "Measured letting revenue less a year of the estimated lease." },
  { id: "occupancy", label: "Best occupancy", hint: "The share of nights listings there are actually booked." },
  { id: "listings", label: "Most listings", hint: "How much competing supply is on the platform." },
  { id: "rent", label: "Cheapest rent", hint: "The estimated median two-bedroom lease, lowest first." },
];

export function MarketsExplorer({ rows }: { rows: MarketRow[] }) {
  const router = useRouter();
  const [query, setQuery] = React.useState<MarketQuery>(EMPTY_QUERY);
  const [sort, setSort] = React.useState<MarketSort>("measured");
  const [panel, setPanel] = React.useState<string | null>(null);
  /** Open. This page was asked for as a map view, and the country is
   *  half of what four hundred rows say — the toggle is for the
   *  reader who wants the table on its own, not the default. */
  const [mapOpen, setMapOpen] = React.useState(true);
  /** The market lit on the map, from a pin or a row. */
  const [selected, setSelected] = React.useState<string | null>(null);

  const states = React.useMemo(
    () => [...new Set(rows.map((r) => r.stateCode))].sort(),
    [rows]
  );
  const measuredCount = React.useMemo(
    () => rows.filter((r) => r.measured).length,
    [rows]
  );
  const shown = React.useMemo(
    () => sortMarkets(filterMarkets(rows, query), sort),
    [rows, query, sort]
  );
  const chosen = React.useMemo(
    () => (selected ? (shown.find((r) => r.slug === selected) ?? null) : null),
    [shown, selected]
  );

  const patch = (next: Partial<MarketQuery>) =>
    setQuery((prev) => ({ ...prev, ...next }));
  const chip = (id: string) => ({
    open: panel === id,
    onOpenChange: (open: boolean) => setPanel(open ? id : null),
  });

  const columns = React.useMemo<DataTableColumn<MarketRow>[]>(
    () => [
      {
        key: "name",
        header: "Market",
        cell: (r) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-sans font-medium text-foreground">{r.name}</span>
            <span className="truncate text-[11px] text-muted-foreground">
              {r.stateCode} · {TERRAIN_LABEL[r.terrain]}
            </span>
          </span>
        ),
        sortValue: (r) => r.name,
        className: "w-full min-w-40 max-w-0",
      },
      {
        key: "rules",
        header: "Regulation",
        cell: (r) => (
          <span className="inline-flex items-center gap-1.5">
            <StatusChip tone={RULE_TONE[r.regulation.status]}>
              {RULE_LABEL[r.regulation.status]}
            </StatusChip>
            <InfoHint label={`the rule in ${r.name}`}>{r.regulation.note}</InfoHint>
          </span>
        ),
        sortValue: (r) => RULE_ORDER.indexOf(r.regulation.status),
        className: "min-w-44",
      },
      {
        key: "revenue",
        header: "Revenue/yr",
        align: "right",
        cell: (r) =>
          r.measured?.revenue != null ? fmtMoneyShort(r.measured.revenue) : NONE,
        sortValue: (r) => r.measured?.revenue ?? -1,
      },
      {
        key: "adr",
        header: "ADR",
        align: "right",
        cell: (r) => (r.measured?.adr != null ? fmtMoney(r.measured.adr) : NONE),
        sortValue: (r) => r.measured?.adr ?? -1,
      },
      {
        key: "occupancy",
        header: "Occupancy",
        align: "right",
        cell: (r) =>
          r.measured?.occupancy != null ? fmtPct(r.measured.occupancy) : NONE,
        sortValue: (r) => r.measured?.occupancy ?? -1,
      },
      {
        key: "listings",
        header: "Listings",
        align: "right",
        cell: (r) =>
          r.measured?.activeListings != null ? fmtNum(r.measured.activeListings) : NONE,
        sortValue: (r) => r.measured?.activeListings ?? -1,
      },
      {
        key: "rent",
        header: "2BR rent",
        align: "right",
        cell: (r) => (
          <span className="text-muted-foreground">{fmtMoney(r.rentEstimate)}</span>
        ),
        sortValue: (r) => r.rentEstimate,
      },
      {
        key: "spread",
        header: "Spread",
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
        sortValue: (r) => r.spread ?? -Infinity,
      },
    ],
    []
  );

  const exportCsv = () => {
    const cols: CsvColumn<MarketRow>[] = [
      { header: "Market", value: (r) => r.name },
      { header: "State", value: (r) => r.stateCode },
      { header: "Type", value: (r) => TERRAIN_LABEL[r.terrain] },
      { header: "Regulation", value: (r) => RULE_LABEL[r.regulation.status] },
      { header: "Rule note", value: (r) => r.regulation.note },
      { header: "Measured revenue/yr", value: (r) => r.measured?.revenue ?? "" },
      { header: "Measured ADR", value: (r) => r.measured?.adr ?? "" },
      { header: "Measured occupancy", value: (r) => r.measured?.occupancy ?? "" },
      { header: "Measured listings", value: (r) => r.measured?.activeListings ?? "" },
      { header: "2BR rent (estimate)", value: (r) => r.rentEstimate },
      { header: "Spread/yr", value: (r) => r.spread ?? "" },
    ];
    downloadCsv(csvFileName("markets"), toCsv(shown, cols));
    toast.success(`Exported ${fmtNum(shown.length)} markets`);
  };

  return (
    <div className="px-4 py-7 md:px-6 lg:px-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          Markets
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every US market this product covers, with the local rule on nightly
          letting. Performance figures are measured, and so far they exist for{" "}
          <span className="tabular text-foreground">{fmtNum(measuredCount)}</span>{" "}
          of them. The rest fill in the first time anybody runs an analysis
          there.
        </p>
      </header>

      {/* Sort presets: the questions somebody opens this page with. */}
      <div className="-mx-4 mt-6 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={sort === p.id}
            title={p.hint}
            onClick={() => setSort(p.id)}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors duration-150",
              sort === p.id
                ? "border-select bg-select text-white"
                : "border-border bg-card text-muted-foreground hover:border-select/40 hover:text-foreground"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Filters. Every one of them is a fact the catalogue was
          researched for, never a figure that was generated. */}
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <div className="relative w-full sm:w-64">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query.query}
            onChange={(e) => patch({ query: e.target.value })}
            placeholder="Search a market or state"
            aria-label="Search markets"
            className="h-9 rounded-full pl-9"
          />
        </div>

        <MultiChip
          {...chip("state")}
          label="State"
          summary={query.states.length > 0 ? `${query.states.length} selected` : undefined}
          options={states.map((s) => ({ value: s, label: s }))}
          selected={query.states}
          onToggle={(v) => patch({ states: toggle(query.states, v) })}
          onClear={() => patch({ states: [] })}
          grid
        />
        <MultiChip
          {...chip("rules")}
          label="Regulation"
          summary={
            query.rules.length > 0
              ? query.rules.map((r) => RULE_LABEL[r]).join(", ")
              : undefined
          }
          options={RULE_ORDER.map((r) => ({ value: r, label: RULE_LABEL[r] }))}
          selected={query.rules}
          onToggle={(v) => patch({ rules: toggle(query.rules, v as RegulationStatus) })}
          onClear={() => patch({ rules: [] })}
        />
        <MultiChip
          {...chip("terrain")}
          label="Market type"
          summary={
            query.terrain.length > 0
              ? query.terrain.map((t) => TERRAIN_LABEL[t]).join(", ")
              : undefined
          }
          options={TERRAIN_ORDER.map((t) => ({ value: t, label: TERRAIN_LABEL[t] }))}
          selected={query.terrain}
          onToggle={(v) => patch({ terrain: toggle(query.terrain, v as MarketTerrain) })}
          onClear={() => patch({ terrain: [] })}
        />

        <label className="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-3.5 text-xs font-medium text-muted-foreground">
          <Switch
            checked={query.measuredOnly}
            onCheckedChange={(on) => patch({ measuredOnly: on })}
            aria-label="Only markets with measured figures"
          />
          Measured only
        </label>

        {isFiltered(query) ? (
          <button
            type="button"
            onClick={() => setQuery(EMPTY_QUERY)}
            className="inline-flex h-9 items-center gap-1 rounded-full px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            <X aria-hidden className="size-3.5" />
            Clear
          </button>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          <span className="hidden text-xs text-muted-foreground tabular sm:block">
            {fmtNum(shown.length)} of {fmtNum(rows.length)}
          </span>
          {/* Where, rather than which — the shape of the rules across
              the country is a thing a sorted list cannot show. */}
          <Button
            variant={mapOpen ? "secondary" : "outline"}
            size="sm"
            aria-pressed={mapOpen}
            onClick={() => setMapOpen((v) => !v)}
            className="gap-1.5"
          >
            <MapIcon aria-hidden className="size-3.5" />
            {mapOpen ? "Hide map" : "Show map"}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
            <FileDown aria-hidden className="size-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "mt-5 grid gap-5",
          mapOpen && "xl:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]"
        )}
      >
      <section className="min-w-0 overflow-hidden rounded-sm border border-border bg-card elev-card">
        <DataTable
          columns={columns}
          rows={shown}
          rowKey={(r) => r.slug}
          onRowClick={(r) => router.push(`/markets/${r.slug}`)}
          // Hovering lights the map rather than selecting it: a click
          // has somewhere better to go now that a market has a page,
          // and a pointer crossing the table on its way elsewhere
          // should not put the map back to nothing.
          onRowHover={(r) => {
            if (r) setSelected(r.slug);
          }}
          rowClassName={(r) =>
            cn("cursor-pointer", selected === r.slug && "bg-gold-fill/[0.07]")
          }
          emptyState={
            <EmptyState
              icon={Search}
              title="No market matches those filters"
              description="Widen the rule or the state, or clear the filters to see all of them."
            />
          }
        />
        <p className="flex flex-wrap items-center gap-x-1.5 border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            Revenue, ADR, occupancy and listings are measured
            <InfoHint label="the measured figures">
              These come from a short-term rental data provider, for the
              markets an analysis has already bought figures for, and are
              shared across every account. A dash means nobody has run one
              there yet — it is not a zero.
            </InfoHint>
          </span>
          <span>·</span>
          <span className="inline-flex items-center gap-1.5">
            the two-bedroom rent is an estimate
            <InfoHint label="the rent estimate">
              A researched median asking lease for a two-bedroom, not a live
              quote, so the spread built on it is a bracket rather than a
              figure. Run a property in the market for that property&apos;s own
              numbers.
            </InfoHint>
          </span>
          <span>·</span>
          <span className="inline-flex items-center gap-1">
            open a market for its areas, its year and its rentals
            <ArrowUpRight aria-hidden className="size-3" />
          </span>
        </p>
      </section>

      {/* Sticky beside a table that can run to four hundred rows: a map
          that scrolled away with the first screen would be a map you
          could only use at the top of the page. */}
      {/* `self-start` or the panel stretches to the row, and the row is
          four hundred table rows tall — a sticky element inside a
          twenty-thousand-pixel box never sticks to anything.

          The height is set here and never left to the grid: MapLibre
          sizes its canvas to whatever its container measures, and a
          container with no resolved height gets a canvas of nothing.
          The two values frame the country rather than fill the page —
          stacked above the table on a phone it is as wide as the screen
          and roughly as tall as the map needs, and beside the table it
          takes the viewport. Every space inside the arbitrary value is
          an underscore; a calc() with real spaces is silently invalid
          CSS and collapses the panel. */}
      {mapOpen ? (
        <aside className="order-first min-w-0 self-start xl:order-none xl:sticky xl:top-20">
          <MarketsMap
            rows={shown}
            selected={selected}
            onSelect={setSelected}
            className="h-[clamp(15rem,58vw,26rem)] w-full xl:h-[clamp(22rem,calc(100dvh_-_15rem),38rem)]"
          />
          {chosen ? (
            <div className="mt-3 rounded-sm border border-border bg-card px-4 py-3">
              <p className="truncate text-sm font-medium text-foreground">
                {chosen.name}, {chosen.stateCode}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {RULE_LABEL[chosen.regulation.status]} · {chosen.regulation.note}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button asChild size="sm" className="gap-1.5">
                  <Link href={`/markets/${chosen.slug}`}>
                    Open market
                    <ArrowUpRight aria-hidden className="size-3.5" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <Link href={`/deals?market=${chosen.slug}`}>Rentals here</Link>
                </Button>
                <SaveMarketButton slug={chosen.slug} name={chosen.name} />
              </div>
            </div>
          ) : null}
        </aside>
      ) : null}
      </div>
    </div>
  );
}

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
}

/** One filter chip: a label, what it is set to, and its checklist. */
function MultiChip({
  label,
  summary,
  options,
  selected,
  onToggle,
  onClear,
  open,
  onOpenChange,
  grid = false,
}: {
  label: string;
  summary?: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** For the long list: three across rather than fifty down. */
  grid?: boolean;
}) {
  const active = selected.length > 0;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={summary ? `${label}: ${summary}` : label}
          className={cn(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors duration-150",
            active
              ? "border-gold/50 bg-gold-fill/10 text-foreground"
              : "border-border bg-card text-muted-foreground hover:text-foreground"
          )}
        >
          {label}
          {summary ? (
            <span className="max-w-32 truncate text-foreground">{summary}</span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="flex items-center justify-between pb-2">
          <span className="metric-label">{label}</span>
          {active ? (
            <button
              type="button"
              onClick={onClear}
              className="text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              Clear
            </button>
          ) : null}
        </div>
        <div
          className={cn(
            "max-h-72 overflow-y-auto",
            grid ? "grid grid-cols-4 gap-1" : "flex flex-col gap-0.5"
          )}
        >
          {options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(o.value)}
                className={cn(
                  "rounded-sm px-2 py-1.5 text-left text-xs transition-colors duration-150",
                  grid && "text-center tabular",
                  on
                    ? "bg-gold-fill/15 font-medium text-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
