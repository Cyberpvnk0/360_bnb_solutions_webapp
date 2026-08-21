"use client";

/**
 * Filter chips + the all-filters sheet for the market explorer. Each chip
 * opens a panel with a draft of its own values and a Reset / Apply row —
 * nothing changes the list until Apply. The "All filters" chip opens a
 * sheet holding every control over one shared draft, with a live result
 * count on the apply button. An active chip carries a gold dot and its
 * summary.
 *
 * `matchesFilters` lives here too — pure and unit-tested. The invariant:
 * a slider bound parked at its DEFAULT extreme means "no bound", so the
 * default view shows every market and submarket we track, including rows
 * whose figures sit outside the slider tracks.
 */

import * as React from "react";
import {
  Building2,
  ChevronDown,
  Mountain,
  SlidersHorizontal,
  Sun,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { MetricLabel } from "@/components/primitives/metric-label";
import { annualRevenueFromAdr, revpar } from "@/lib/calc/arbitrage";
import { fmtMoney, fmtMoneyShort, fmtNum, fmtPct } from "@/lib/format";
import type { MarketTerrain } from "@/lib/mock/types";
import { cn } from "@/lib/utils";
import { TERRAIN_LABEL } from "./market-banner";

/* ------------------------------------------------------------------ */
/* Filter state                                                        */
/* ------------------------------------------------------------------ */

export interface ExplorerFilters {
  /** Substring match on market name or state. */
  query: string;
  /** Empty = all states. */
  states: string[];
  /** Empty = every market type. */
  terrains: MarketTerrain[];
  /** Occupancy range, fractions. */
  occMin: number;
  occMax: number;
  /** Nightly rate range, dollars. */
  adrMin: number;
  adrMax: number;
  /** Active listing count range. */
  listingsMin: number;
  listingsMax: number;
  /** Minimum revenue potential — $/listing/yr via annualRevenueFromAdr. 0 = any. */
  revenueMin: number;
  /** Minimum RevPAR, dollars per available night. 0 = any. */
  revparMin: number;
  /** Median 2 bd rent range, $/mo. */
  rentMin: number;
  rentMax: number;
  /** Highest acceptable 2 bd breakeven occupancy (fraction). 1 = any. */
  breakevenMax: number;
  /** Minimum margin of safety in points (occupancy − breakeven). */
  marginMin: number;
}

/** Slider track bounds. A bound parked at a track extreme means "no bound". */
const LISTINGS_TRACK = { min: 0, max: 10_000, step: 250 };
const REVENUE_TRACK = { min: 0, max: 70_000, step: 5_000 };
const REVPAR_TRACK = { min: 0, max: 200, step: 5 };
const RENT_TRACK = { min: 600, max: 3200, step: 25 };
/** Percent points on the track; the top end means "any breakeven". */
const BREAKEVEN_TRACK = { min: 20, max: 80, step: 1 };

export const DEFAULT_FILTERS: ExplorerFilters = {
  query: "",
  states: [],
  terrains: [],
  occMin: 0.4,
  occMax: 0.8,
  adrMin: 90,
  adrMax: 320,
  listingsMin: LISTINGS_TRACK.min,
  listingsMax: LISTINGS_TRACK.max,
  revenueMin: REVENUE_TRACK.min,
  revparMin: REVPAR_TRACK.min,
  rentMin: RENT_TRACK.min,
  rentMax: RENT_TRACK.max,
  breakevenMax: 1,
  marginMin: 0,
};

export function isDefaultFilters(f: ExplorerFilters): boolean {
  return (
    f.query === "" &&
    f.states.length === 0 &&
    f.terrains.length === 0 &&
    f.occMin === DEFAULT_FILTERS.occMin &&
    f.occMax === DEFAULT_FILTERS.occMax &&
    f.adrMin === DEFAULT_FILTERS.adrMin &&
    f.adrMax === DEFAULT_FILTERS.adrMax &&
    f.listingsMin === DEFAULT_FILTERS.listingsMin &&
    f.listingsMax === DEFAULT_FILTERS.listingsMax &&
    f.revenueMin === DEFAULT_FILTERS.revenueMin &&
    f.revparMin === DEFAULT_FILTERS.revparMin &&
    f.rentMin === DEFAULT_FILTERS.rentMin &&
    f.rentMax === DEFAULT_FILTERS.rentMax &&
    f.breakevenMax === DEFAULT_FILTERS.breakevenMax &&
    f.marginMin === DEFAULT_FILTERS.marginMin
  );
}

/** How many filter groups sit off their defaults — the badge on "All filters". */
function countActiveFilters(f: ExplorerFilters): number {
  let n = 0;
  if (f.query !== "") n++;
  if (f.states.length > 0) n++;
  if (f.terrains.length > 0) n++;
  if (
    f.listingsMin > DEFAULT_FILTERS.listingsMin ||
    f.listingsMax < DEFAULT_FILTERS.listingsMax
  ) {
    n++;
  }
  if (f.adrMin > DEFAULT_FILTERS.adrMin || f.adrMax < DEFAULT_FILTERS.adrMax) n++;
  if (f.occMin > DEFAULT_FILTERS.occMin || f.occMax < DEFAULT_FILTERS.occMax) n++;
  if (f.revenueMin > DEFAULT_FILTERS.revenueMin) n++;
  if (f.revparMin > DEFAULT_FILTERS.revparMin) n++;
  if (f.rentMin > DEFAULT_FILTERS.rentMin || f.rentMax < DEFAULT_FILTERS.rentMax) n++;
  if (f.breakevenMax < DEFAULT_FILTERS.breakevenMax) n++;
  if (f.marginMin > DEFAULT_FILTERS.marginMin) n++;
  return n;
}

/* ------------------------------------------------------------------ */
/* Matching — pure, shared by both explorer scopes and the live count  */
/* ------------------------------------------------------------------ */

/** The figures both markets and submarkets expose. */
export interface Sortable {
  adr: number;
  occupancy: number;
  activeListings: number;
  avgBreakeven2br: number;
  medianRent2br: number;
  stateCode: string;
}

/**
 * Does one row survive the current filters? `terrainOf` resolves the row's
 * market type — markets carry their own, submarkets borrow the parent's.
 * It is only consulted when a terrain filter is actually set.
 */
export function matchesFilters<R extends Sortable>(
  r: R,
  haystack: string,
  filters: ExplorerFilters,
  terrainOf: (r: R) => MarketTerrain
): boolean {
  const q = filters.query.toLowerCase();
  if (q && !haystack.includes(q)) return false;
  if (filters.states.length > 0 && !filters.states.includes(r.stateCode)) {
    return false;
  }
  if (filters.terrains.length > 0 && !filters.terrains.includes(terrainOf(r))) {
    return false;
  }
  // Slider bounds at their default extremes mean "no bound" — submarkets
  // range a little wider than the slider tracks, and the default view must
  // show every one of them.
  if (filters.occMin > DEFAULT_FILTERS.occMin && r.occupancy < filters.occMin) {
    return false;
  }
  if (filters.occMax < DEFAULT_FILTERS.occMax && r.occupancy > filters.occMax) {
    return false;
  }
  if (filters.adrMin > DEFAULT_FILTERS.adrMin && r.adr < filters.adrMin) {
    return false;
  }
  if (filters.adrMax < DEFAULT_FILTERS.adrMax && r.adr > filters.adrMax) {
    return false;
  }
  if (
    filters.listingsMin > DEFAULT_FILTERS.listingsMin &&
    r.activeListings < filters.listingsMin
  ) {
    return false;
  }
  if (
    filters.listingsMax < DEFAULT_FILTERS.listingsMax &&
    r.activeListings > filters.listingsMax
  ) {
    return false;
  }
  if (
    filters.revenueMin > DEFAULT_FILTERS.revenueMin &&
    annualRevenueFromAdr(r.adr, r.occupancy) < filters.revenueMin
  ) {
    return false;
  }
  if (
    filters.revparMin > DEFAULT_FILTERS.revparMin &&
    revpar(r.adr, r.occupancy) < filters.revparMin
  ) {
    return false;
  }
  if (filters.rentMin > DEFAULT_FILTERS.rentMin && r.medianRent2br < filters.rentMin) {
    return false;
  }
  if (filters.rentMax < DEFAULT_FILTERS.rentMax && r.medianRent2br > filters.rentMax) {
    return false;
  }
  if (
    filters.breakevenMax < DEFAULT_FILTERS.breakevenMax &&
    r.avgBreakeven2br > filters.breakevenMax
  ) {
    return false;
  }
  // "Any" (the default) keeps negative-cushion rows visible — muted red is
  // a signal the user must see, not a row to hide.
  if (
    filters.marginMin > DEFAULT_FILTERS.marginMin &&
    (r.occupancy - r.avgBreakeven2br) * 100 < filters.marginMin
  ) {
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Chip + panel scaffolding                                            */
/* ------------------------------------------------------------------ */

function FilterChip({
  label,
  summary,
  active,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  summary?: string;
  active: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors duration-150",
            active
              ? "border-gold/50 bg-gold-fill/5 text-foreground"
              : "border-border text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
          )}
        >
          {active ? (
            <span aria-hidden className="size-1.5 rounded-full bg-gold-fill" />
          ) : null}
          {label}
          {active && summary ? (
            <span className="max-w-32 truncate font-normal text-muted-foreground">
              {summary}
            </span>
          ) : null}
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3.5 text-muted-foreground transition-transform duration-150",
              open && "rotate-180"
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function PanelFooter({
  onReset,
  onApply,
}: {
  onReset: () => void;
  onApply: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
      <Button
        variant="ghost"
        size="sm"
        onClick={onReset}
        className="text-muted-foreground"
      >
        Reset
      </Button>
      <Button size="sm" onClick={onApply}>
        Apply
      </Button>
    </div>
  );
}

function PanelBody({ children }: { children: React.ReactNode }) {
  return <div className="space-y-5 p-4">{children}</div>;
}

function RangeReadout({
  low,
  high,
}: {
  low: string;
  high: string;
}) {
  return (
    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground tabular">
      <span>{low}</span>
      <span>{high}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared controls — one control, two surfaces (chip panel + sheet)    */
/* ------------------------------------------------------------------ */

function StateGrid({
  states,
  selected,
  onToggle,
  className,
}: {
  states: string[];
  selected: string[];
  onToggle: (code: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-4 gap-1.5", className)}>
      {states.map((code) => {
        const on = selected.includes(code);
        return (
          <button
            key={code}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(code)}
            className={cn(
              "h-7 rounded-sm border text-xs transition-colors duration-150 tabular",
              on
                ? "border-gold/50 bg-gold-fill/10 font-medium text-gold"
                : "border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            )}
          >
            {code}
          </button>
        );
      })}
    </div>
  );
}

const TERRAIN_OPTIONS: { id: MarketTerrain; icon: LucideIcon }[] = [
  { id: "metro", icon: Building2 },
  { id: "coastal", icon: Waves },
  { id: "mountain", icon: Mountain },
  { id: "desert", icon: Sun },
];

function TerrainTiles({
  selected,
  onToggle,
}: {
  selected: MarketTerrain[];
  onToggle: (t: MarketTerrain) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {TERRAIN_OPTIONS.map(({ id, icon: Icon }) => {
        const on = selected.includes(id);
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(id)}
            className={cn(
              "flex items-center gap-2 rounded-sm border px-3 py-2.5 text-sm transition-colors duration-150",
              on
                ? "border-gold/50 bg-gold-fill/10 font-medium text-gold"
                : "border-border text-foreground hover:bg-secondary/60"
            )}
          >
            <Icon
              aria-hidden
              className={cn("size-3.5", on ? "text-gold" : "text-muted-foreground")}
            />
            {TERRAIN_LABEL[id]}
          </button>
        );
      })}
    </div>
  );
}

const REVENUE_PRESETS = [
  { value: 0, label: "Any" },
  { value: 25_000, label: "$25K+" },
  { value: 40_000, label: "$40K+" },
  { value: 55_000, label: "$55K+" },
];

function RevenueControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-1.5">
        {REVENUE_PRESETS.map((p) => {
          const on = value === p.value;
          return (
            <button
              key={p.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(p.value)}
              className={cn(
                "h-8 rounded-sm border text-xs transition-colors duration-150 tabular",
                on
                  ? "border-gold/50 bg-gold-fill/10 font-medium text-gold"
                  : "border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div>
        <Slider
          value={[value]}
          onValueChange={(v) => onChange(v[0])}
          min={REVENUE_TRACK.min}
          max={REVENUE_TRACK.max}
          step={REVENUE_TRACK.step}
          aria-label="Minimum revenue potential per year"
        />
        <RangeReadout
          low={value <= REVENUE_TRACK.min ? "Any" : `${fmtMoneyShort(value)}+ / yr`}
          high={fmtMoneyShort(REVENUE_TRACK.max)}
        />
      </div>
    </div>
  );
}

function MarginTiles({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      {MARGIN_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex w-full items-center justify-between rounded-sm border px-3 py-2 text-sm transition-colors duration-150",
            value === o.value
              ? "border-gold/50 bg-gold-fill/10 font-medium text-gold"
              : "border-border text-foreground hover:bg-secondary/60"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chip panels                                                         */
/* ------------------------------------------------------------------ */

function MarketPanel({
  applied,
  states,
  onApply,
  onClose,
}: {
  applied: ExplorerFilters;
  states: string[];
  onApply: (patch: Partial<ExplorerFilters>) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = React.useState(applied.query);
  const [selected, setSelected] = React.useState<string[]>(applied.states);
  const [listings, setListings] = React.useState<[number, number]>([
    applied.listingsMin,
    applied.listingsMax,
  ]);

  const toggleState = (code: string) =>
    setSelected((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );

  return (
    <>
      <PanelBody>
        <div>
          <Label htmlFor="mf-query" className="text-xs text-muted-foreground">
            Search market
          </Label>
          <Input
            id="mf-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or state…"
            className="mt-1.5 h-8"
          />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">States</p>
          <StateGrid
            states={states}
            selected={selected}
            onToggle={toggleState}
            className="mt-1.5"
          />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Active listings</p>
          <Slider
            value={listings}
            onValueChange={(v) => setListings([v[0], v[1]] as [number, number])}
            min={LISTINGS_TRACK.min}
            max={LISTINGS_TRACK.max}
            step={LISTINGS_TRACK.step}
            className="mt-3"
            aria-label="Active listing count range"
          />
          <RangeReadout
            low={fmtNum(listings[0])}
            high={
              listings[1] >= LISTINGS_TRACK.max
                ? `${fmtNum(LISTINGS_TRACK.max)}+`
                : fmtNum(listings[1])
            }
          />
        </div>
      </PanelBody>
      <PanelFooter
        onReset={() => {
          setQuery("");
          setSelected([]);
          setListings([DEFAULT_FILTERS.listingsMin, DEFAULT_FILTERS.listingsMax]);
        }}
        onApply={() => {
          onApply({
            query: query.trim(),
            states: selected,
            listingsMin: listings[0],
            listingsMax: listings[1],
          });
          onClose();
        }}
      />
    </>
  );
}

function TerrainPanel({
  applied,
  onApply,
  onClose,
}: {
  applied: ExplorerFilters;
  onApply: (patch: Partial<ExplorerFilters>) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = React.useState<MarketTerrain[]>(applied.terrains);

  const toggle = (t: MarketTerrain) =>
    setSelected((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );

  return (
    <>
      <PanelBody>
        <p className="text-xs text-muted-foreground">
          The setting guests book. Pick any mix — none picked means all.
        </p>
        <TerrainTiles selected={selected} onToggle={toggle} />
      </PanelBody>
      <PanelFooter
        onReset={() => setSelected([])}
        onApply={() => {
          onApply({ terrains: selected });
          onClose();
        }}
      />
    </>
  );
}

/** Nightly-rate tiers — plain dollar bands, no hotel-speak. */
const RATE_TIERS: { label: string; sub: string; min: number; max: number }[] = [
  { label: "Under $120", sub: "entry", min: DEFAULT_FILTERS.adrMin, max: 120 },
  { label: "$120–180", sub: "core", min: 120, max: 180 },
  { label: "$180–250", sub: "premium", min: 180, max: 250 },
  { label: "$250+", sub: "top end", min: 250, max: DEFAULT_FILTERS.adrMax },
];

function RatePanel({
  applied,
  onApply,
  onClose,
}: {
  applied: ExplorerFilters;
  onApply: (patch: Partial<ExplorerFilters>) => void;
  onClose: () => void;
}) {
  const [range, setRange] = React.useState<[number, number]>([
    applied.adrMin,
    applied.adrMax,
  ]);

  return (
    <>
      <PanelBody>
        <div className="grid grid-cols-2 gap-1.5">
          {RATE_TIERS.map((tier) => {
            const on = range[0] === tier.min && range[1] === tier.max;
            return (
              <button
                key={tier.label}
                type="button"
                aria-pressed={on}
                onClick={() => setRange([tier.min, tier.max])}
                className={cn(
                  "rounded-sm border px-3 py-2.5 text-left transition-colors duration-150",
                  on
                    ? "border-gold/50 bg-gold-fill/10"
                    : "border-border hover:bg-secondary/60"
                )}
              >
                <span
                  className={cn(
                    "block text-sm font-medium tabular",
                    on ? "text-gold" : "text-foreground"
                  )}
                >
                  {tier.label}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {tier.sub}
                </span>
              </button>
            );
          })}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Custom range</p>
          <Slider
            value={range}
            onValueChange={(v) => setRange([v[0], v[1]] as [number, number])}
            min={DEFAULT_FILTERS.adrMin}
            max={DEFAULT_FILTERS.adrMax}
            step={5}
            className="mt-3"
            aria-label="Nightly rate range"
          />
          <RangeReadout
            low={fmtMoney(range[0])}
            high={
              range[1] >= DEFAULT_FILTERS.adrMax
                ? `${fmtMoney(DEFAULT_FILTERS.adrMax)}+`
                : fmtMoney(range[1])
            }
          />
        </div>
      </PanelBody>
      <PanelFooter
        onReset={() => setRange([DEFAULT_FILTERS.adrMin, DEFAULT_FILTERS.adrMax])}
        onApply={() => {
          onApply({ adrMin: range[0], adrMax: range[1] });
          onClose();
        }}
      />
    </>
  );
}

function OccupancyPanel({
  applied,
  onApply,
  onClose,
}: {
  applied: ExplorerFilters;
  onApply: (patch: Partial<ExplorerFilters>) => void;
  onClose: () => void;
}) {
  const [range, setRange] = React.useState<[number, number]>([
    Math.round(applied.occMin * 100),
    Math.round(applied.occMax * 100),
  ]);

  return (
    <>
      <PanelBody>
        <div>
          <p className="text-xs text-muted-foreground">
            Share of nights booked, trailing 12 months
          </p>
          <Slider
            value={range}
            onValueChange={(v) => setRange([v[0], v[1]] as [number, number])}
            min={40}
            max={80}
            step={1}
            className="mt-3"
            aria-label="Occupancy range"
          />
          <RangeReadout low={`${range[0]}%`} high={`${range[1]}%`} />
        </div>
      </PanelBody>
      <PanelFooter
        onReset={() =>
          setRange([DEFAULT_FILTERS.occMin * 100, DEFAULT_FILTERS.occMax * 100])
        }
        onApply={() => {
          onApply({ occMin: range[0] / 100, occMax: range[1] / 100 });
          onClose();
        }}
      />
    </>
  );
}

function RevenuePanel({
  applied,
  onApply,
  onClose,
}: {
  applied: ExplorerFilters;
  onApply: (patch: Partial<ExplorerFilters>) => void;
  onClose: () => void;
}) {
  const [value, setValue] = React.useState(applied.revenueMin);

  return (
    <>
      <PanelBody>
        <p className="text-xs text-muted-foreground">
          What one listing clears in a year at the market&rsquo;s nightly rate
          and occupancy, trailing 12 months.
        </p>
        <RevenueControl value={value} onChange={setValue} />
      </PanelBody>
      <PanelFooter
        onReset={() => setValue(DEFAULT_FILTERS.revenueMin)}
        onApply={() => {
          onApply({ revenueMin: value });
          onClose();
        }}
      />
    </>
  );
}

const MARGIN_OPTIONS = [
  { value: 0, label: "Any cushion" },
  { value: 10, label: "10+ pts over breakeven" },
  { value: 20, label: "20+ pts over breakeven" },
  { value: 30, label: "30+ pts over breakeven" },
];

function CushionPanel({
  applied,
  onApply,
  onClose,
}: {
  applied: ExplorerFilters;
  onApply: (patch: Partial<ExplorerFilters>) => void;
  onClose: () => void;
}) {
  const [value, setValue] = React.useState(applied.marginMin);
  return (
    <>
      <PanelBody>
        <p className="text-xs text-muted-foreground">
          How far the market runs above the typical 2 bd breakeven.
        </p>
        <MarginTiles value={value} onChange={setValue} />
      </PanelBody>
      <PanelFooter
        onReset={() => setValue(0)}
        onApply={() => {
          onApply({ marginMin: value });
          onClose();
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* All-filters sheet — every control, one draft, live result count     */
/* ------------------------------------------------------------------ */

function SheetSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <MetricLabel>{label}</MetricLabel>
      {children}
    </section>
  );
}

function FieldLabel({
  label,
  sub,
}: {
  label: string;
  sub?: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-foreground">{label}</p>
      {sub ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

function AllFiltersBody({
  applied,
  states,
  countFor,
  onApply,
  onClose,
}: {
  applied: ExplorerFilters;
  states: string[];
  countFor: (draft: ExplorerFilters) => number;
  onApply: (next: ExplorerFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = React.useState<ExplorerFilters>(applied);
  const patch = (p: Partial<ExplorerFilters>) =>
    setDraft((d) => ({ ...d, ...p }));

  const count = countFor(draft);

  const breakevenSlider =
    draft.breakevenMax >= DEFAULT_FILTERS.breakevenMax
      ? BREAKEVEN_TRACK.max
      : Math.min(
          BREAKEVEN_TRACK.max,
          Math.max(BREAKEVEN_TRACK.min, Math.round(draft.breakevenMax * 100))
        );

  return (
    <>
      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5">
        <SheetSection label="Market">
          <div>
            <Label htmlFor="af-query" className="text-xs font-medium text-foreground">
              Search
            </Label>
            <Input
              id="af-query"
              value={draft.query}
              onChange={(e) => patch({ query: e.target.value })}
              placeholder="Name or state…"
              className="mt-1.5 h-8"
            />
          </div>
          <div>
            <FieldLabel label="States" />
            <StateGrid
              states={states}
              selected={draft.states}
              onToggle={(code) =>
                patch({
                  states: draft.states.includes(code)
                    ? draft.states.filter((c) => c !== code)
                    : [...draft.states, code],
                })
              }
              className="mt-1.5 grid-cols-5"
            />
          </div>
          <div>
            <FieldLabel label="Active listings" />
            <Slider
              value={[draft.listingsMin, draft.listingsMax]}
              onValueChange={(v) =>
                patch({ listingsMin: v[0], listingsMax: v[1] })
              }
              min={LISTINGS_TRACK.min}
              max={LISTINGS_TRACK.max}
              step={LISTINGS_TRACK.step}
              className="mt-3"
              aria-label="Active listing count range"
            />
            <RangeReadout
              low={fmtNum(draft.listingsMin)}
              high={
                draft.listingsMax >= LISTINGS_TRACK.max
                  ? `${fmtNum(LISTINGS_TRACK.max)}+`
                  : fmtNum(draft.listingsMax)
              }
            />
          </div>
        </SheetSection>

        <SheetSection label="Performance">
          <div>
            <FieldLabel label="Nightly rate" />
            <Slider
              value={[draft.adrMin, draft.adrMax]}
              onValueChange={(v) => patch({ adrMin: v[0], adrMax: v[1] })}
              min={DEFAULT_FILTERS.adrMin}
              max={DEFAULT_FILTERS.adrMax}
              step={5}
              className="mt-3"
              aria-label="Nightly rate range"
            />
            <RangeReadout
              low={fmtMoney(draft.adrMin)}
              high={
                draft.adrMax >= DEFAULT_FILTERS.adrMax
                  ? `${fmtMoney(DEFAULT_FILTERS.adrMax)}+`
                  : fmtMoney(draft.adrMax)
              }
            />
          </div>
          <div>
            <FieldLabel label="Occupancy" sub="Share of nights booked, trailing 12 months" />
            <Slider
              value={[
                Math.round(draft.occMin * 100),
                Math.round(draft.occMax * 100),
              ]}
              onValueChange={(v) =>
                patch({ occMin: v[0] / 100, occMax: v[1] / 100 })
              }
              min={40}
              max={80}
              step={1}
              className="mt-3"
              aria-label="Occupancy range"
            />
            <RangeReadout
              low={fmtPct(draft.occMin)}
              high={fmtPct(draft.occMax)}
            />
          </div>
          <div>
            <FieldLabel
              label="Revenue potential"
              sub="Per listing per year, at market rate and occupancy"
            />
            <div className="mt-3">
              <RevenueControl
                value={draft.revenueMin}
                onChange={(v) => patch({ revenueMin: v })}
              />
            </div>
          </div>
          <div>
            <FieldLabel label="RevPAR" sub="$ per available night" />
            <Slider
              value={[draft.revparMin]}
              onValueChange={(v) => patch({ revparMin: v[0] })}
              min={REVPAR_TRACK.min}
              max={REVPAR_TRACK.max}
              step={REVPAR_TRACK.step}
              className="mt-3"
              aria-label="Minimum RevPAR"
            />
            <RangeReadout
              low={
                draft.revparMin <= REVPAR_TRACK.min
                  ? "Any"
                  : `${fmtMoney(draft.revparMin)}+`
              }
              high={fmtMoney(REVPAR_TRACK.max)}
            />
          </div>
        </SheetSection>

        <SheetSection label="The lease">
          <div>
            <FieldLabel label="Median 2 bd rent" sub="Asking rent for a long-term lease" />
            <Slider
              value={[draft.rentMin, draft.rentMax]}
              onValueChange={(v) => patch({ rentMin: v[0], rentMax: v[1] })}
              min={RENT_TRACK.min}
              max={RENT_TRACK.max}
              step={RENT_TRACK.step}
              className="mt-3"
              aria-label="Median 2 bedroom rent range"
            />
            <RangeReadout
              low={fmtMoney(draft.rentMin)}
              high={
                draft.rentMax >= RENT_TRACK.max
                  ? `${fmtMoney(RENT_TRACK.max)}+`
                  : fmtMoney(draft.rentMax)
              }
            />
          </div>
          <div>
            <FieldLabel
              label="Breakeven (max)"
              sub="Keep markets whose typical 2 bd breakeven sits at or under this"
            />
            <Slider
              value={[breakevenSlider]}
              onValueChange={(v) =>
                patch({
                  breakevenMax:
                    v[0] >= BREAKEVEN_TRACK.max
                      ? DEFAULT_FILTERS.breakevenMax
                      : v[0] / 100,
                })
              }
              min={BREAKEVEN_TRACK.min}
              max={BREAKEVEN_TRACK.max}
              step={BREAKEVEN_TRACK.step}
              className="mt-3"
              aria-label="Maximum breakeven occupancy"
            />
            <RangeReadout
              low={
                draft.breakevenMax >= DEFAULT_FILTERS.breakevenMax
                  ? "Any"
                  : `≤ ${Math.round(draft.breakevenMax * 100)}%`
              }
              high={`${BREAKEVEN_TRACK.max}%`}
            />
          </div>
        </SheetSection>

        <SheetSection label="Signal">
          <div>
            <FieldLabel
              label="Cushion"
              sub="How far the market runs above the typical 2 bd breakeven"
            />
            <div className="mt-2">
              <MarginTiles
                value={draft.marginMin}
                onChange={(v) => patch({ marginMin: v })}
              />
            </div>
          </div>
        </SheetSection>

        <SheetSection label="Market type">
          <TerrainTiles
            selected={draft.terrains}
            onToggle={(t) =>
              patch({
                terrains: draft.terrains.includes(t)
                  ? draft.terrains.filter((x) => x !== t)
                  : [...draft.terrains, t],
              })
            }
          />
        </SheetSection>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-4">
        <Button
          variant="ghost"
          onClick={() => setDraft({ ...DEFAULT_FILTERS })}
          className="text-muted-foreground"
        >
          Reset all
        </Button>
        <Button
          className="flex-1"
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          Show {fmtNum(count)} {count === 1 ? "result" : "results"}
        </Button>
      </div>
    </>
  );
}

function AllFiltersChip({
  filters,
  states,
  activeCount,
  countFor,
  onApply,
}: {
  filters: ExplorerFilters;
  states: string[];
  activeCount: number;
  countFor: (draft: ExplorerFilters) => number;
  onApply: (next: ExplorerFilters) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const active = activeCount > 0;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors duration-150",
            active
              ? "border-gold/50 bg-gold-fill/5 text-foreground"
              : "border-border text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
          )}
        >
          <SlidersHorizontal aria-hidden className="size-3.5" />
          All filters
          {active ? (
            <span className="flex size-4 items-center justify-center rounded-full bg-gold-fill/15 text-[10px] font-semibold text-gold tabular">
              {activeCount}
            </span>
          ) : null}
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full gap-0 border-border bg-card p-0 sm:w-[400px] sm:max-w-[400px]"
      >
        <SheetHeader className="shrink-0 border-b border-border px-5 py-4">
          <SheetTitle className="text-base">All filters</SheetTitle>
          <SheetDescription className="text-xs">
            Every lens on the explorer. Nothing changes until you show results.
          </SheetDescription>
        </SheetHeader>
        <AllFiltersBody
          applied={filters}
          states={states}
          countFor={countFor}
          onApply={onApply}
          onClose={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* The chip row                                                        */
/* ------------------------------------------------------------------ */

export function ExplorerFilterChips({
  filters,
  states,
  onChange,
  countFor,
}: {
  filters: ExplorerFilters;
  states: string[];
  onChange: (patch: Partial<ExplorerFilters>) => void;
  countFor: (draft: ExplorerFilters) => number;
}) {
  const [openPanel, setOpenPanel] = React.useState<string | null>(null);

  const marketActive =
    filters.query !== "" ||
    filters.states.length > 0 ||
    filters.listingsMin > DEFAULT_FILTERS.listingsMin ||
    filters.listingsMax < DEFAULT_FILTERS.listingsMax;
  const terrainActive = filters.terrains.length > 0;
  const rateActive =
    filters.adrMin > DEFAULT_FILTERS.adrMin ||
    filters.adrMax < DEFAULT_FILTERS.adrMax;
  const occActive =
    filters.occMin > DEFAULT_FILTERS.occMin ||
    filters.occMax < DEFAULT_FILTERS.occMax;
  const revenueActive = filters.revenueMin > DEFAULT_FILTERS.revenueMin;
  const cushionActive = filters.marginMin > 0;

  const chip = (id: string) => ({
    open: openPanel === id,
    onOpenChange: (open: boolean) => setOpenPanel(open ? id : null),
  });
  const close = () => setOpenPanel(null);

  return (
    <>
      <FilterChip
        label="Market"
        active={marketActive}
        summary={
          filters.query ||
          (filters.states.length > 0 ? filters.states.join(", ") : "size")
        }
        {...chip("market")}
      >
        <MarketPanel
          applied={filters}
          states={states}
          onApply={onChange}
          onClose={close}
        />
      </FilterChip>

      <FilterChip
        label="Market type"
        active={terrainActive}
        summary={filters.terrains.map((t) => TERRAIN_LABEL[t]).join(", ")}
        {...chip("terrain")}
      >
        <TerrainPanel applied={filters} onApply={onChange} onClose={close} />
      </FilterChip>

      <FilterChip
        label="Nightly rate"
        active={rateActive}
        summary={`${fmtMoney(filters.adrMin)}–${fmtMoney(filters.adrMax)}`}
        {...chip("rate")}
      >
        <RatePanel applied={filters} onApply={onChange} onClose={close} />
      </FilterChip>

      <FilterChip
        label="Occupancy"
        active={occActive}
        summary={`${fmtPct(filters.occMin)}–${fmtPct(filters.occMax)}`}
        {...chip("occupancy")}
      >
        <OccupancyPanel applied={filters} onApply={onChange} onClose={close} />
      </FilterChip>

      <FilterChip
        label="Revenue"
        active={revenueActive}
        summary={`${fmtMoneyShort(filters.revenueMin)}+ / yr`}
        {...chip("revenue")}
      >
        <RevenuePanel applied={filters} onApply={onChange} onClose={close} />
      </FilterChip>

      <FilterChip
        label="Cushion"
        active={cushionActive}
        summary={`${filters.marginMin}+ pts`}
        {...chip("cushion")}
      >
        <CushionPanel applied={filters} onApply={onChange} onClose={close} />
      </FilterChip>

      <AllFiltersChip
        filters={filters}
        states={states}
        activeCount={countActiveFilters(filters)}
        countFor={countFor}
        onApply={(next) => onChange(next)}
      />
    </>
  );
}
