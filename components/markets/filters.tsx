"use client";

/**
 * Filter chips for the market explorer. Each chip opens a panel with a
 * draft of its own values and a Reset / Apply row — nothing changes the
 * list until Apply. An active chip carries a gold dot and its summary.
 */

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Filter state                                                        */
/* ------------------------------------------------------------------ */

export interface ExplorerFilters {
  /** Substring match on market name or state. */
  query: string;
  /** Empty = all states. */
  states: string[];
  /** Occupancy range, fractions. */
  occMin: number;
  occMax: number;
  /** Nightly rate range, dollars. */
  adrMin: number;
  adrMax: number;
  /** Active listing count range. */
  listingsMin: number;
  listingsMax: number;
  /** Minimum margin of safety in points (occupancy − breakeven). */
  marginMin: number;
}

export const DEFAULT_FILTERS: ExplorerFilters = {
  query: "",
  states: [],
  occMin: 0.4,
  occMax: 0.8,
  adrMin: 90,
  adrMax: 320,
  listingsMin: 0,
  listingsMax: 10000,
  marginMin: 0,
};

export function isDefaultFilters(f: ExplorerFilters): boolean {
  return (
    f.query === "" &&
    f.states.length === 0 &&
    f.occMin === DEFAULT_FILTERS.occMin &&
    f.occMax === DEFAULT_FILTERS.occMax &&
    f.adrMin === DEFAULT_FILTERS.adrMin &&
    f.adrMax === DEFAULT_FILTERS.adrMax &&
    f.listingsMin === DEFAULT_FILTERS.listingsMin &&
    f.listingsMax === DEFAULT_FILTERS.listingsMax &&
    f.marginMin === DEFAULT_FILTERS.marginMin
  );
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
            "flex h-8 shrink-0 items-center gap-1.5 rounded-sm border px-3 text-xs font-medium transition-colors duration-150",
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
/* Panels                                                              */
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
          <div className="mt-1.5 grid grid-cols-4 gap-1.5">
            {states.map((code) => {
              const on = selected.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleState(code)}
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
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Active listings</p>
          <Slider
            value={listings}
            onValueChange={(v) => setListings([v[0], v[1]] as [number, number])}
            min={0}
            max={10000}
            step={250}
            className="mt-3"
            aria-label="Active listing count range"
          />
          <RangeReadout
            low={fmtNum(listings[0])}
            high={listings[1] >= 10000 ? "10,000+" : fmtNum(listings[1])}
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
        <div className="space-y-1.5">
          {MARGIN_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={value === o.value}
              onClick={() => setValue(o.value)}
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
/* The chip row                                                        */
/* ------------------------------------------------------------------ */

export function ExplorerFilterChips({
  filters,
  states,
  onChange,
}: {
  filters: ExplorerFilters;
  states: string[];
  onChange: (patch: Partial<ExplorerFilters>) => void;
}) {
  const [openPanel, setOpenPanel] = React.useState<string | null>(null);

  const marketActive =
    filters.query !== "" ||
    filters.states.length > 0 ||
    filters.listingsMin > DEFAULT_FILTERS.listingsMin ||
    filters.listingsMax < DEFAULT_FILTERS.listingsMax;
  const rateActive =
    filters.adrMin > DEFAULT_FILTERS.adrMin ||
    filters.adrMax < DEFAULT_FILTERS.adrMax;
  const occActive =
    filters.occMin > DEFAULT_FILTERS.occMin ||
    filters.occMax < DEFAULT_FILTERS.occMax;
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
        label="Cushion"
        active={cushionActive}
        summary={`${filters.marginMin}+ pts`}
        {...chip("cushion")}
      >
        <CushionPanel applied={filters} onApply={onChange} onClose={close} />
      </FilterChip>
    </>
  );
}
