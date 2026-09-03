"use client";

/**
 * Filter chips for the Deal Finder — Zillow-familiar: Location, Price,
 * Beds, Baths, Home type. Each chip opens a panel holding a draft of its
 * own values with a Reset / Apply row; nothing changes the list until
 * Apply. An active chip carries a gold dot and its summary. Local to
 * /deals by design (the markets explorer keeps its own chips).
 */

import * as React from "react";
import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { fmtMoney } from "@/lib/format";
import type { PropertyType } from "@/lib/mock/types";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Filter state                                                        */
/* ------------------------------------------------------------------ */

export const TYPE_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: "apartment", label: "Apartment" },
  { value: "house", label: "House" },
  { value: "condo", label: "Condo" },
  { value: "townhome", label: "Townhome" },
];

export const TYPE_LABEL: Record<PropertyType, string> = {
  apartment: "Apartment",
  house: "House",
  condo: "Condo",
  townhome: "Townhome",
};

export interface DealFilters {
  /** Substring match on market name or state. */
  query: string;
  /** Monthly rent bounds; the slider extremes mean "no bound". */
  rentMin: number;
  rentMax: number;
  /**
   * Exact counts to keep; empty = any. 5 means "5 or more", so the
   * top tile stays open-ended without a second field.
   *
   * Chosen over a minimum because a minimum cannot express the search
   * people actually run: someone shopping one-bedroom arbitrage does
   * not want a five-bed on the list, and "1+" hands them every one.
   */
  beds: number[];
  /** Exact counts to keep; empty = any. 5 means "5 or more". */
  baths: number[];
  /** All four checked = everything. */
  types: PropertyType[];
  /** The deal-maker: only listings tagged Furnished (their furnishing
   *  budget can start at $0). First-class, not a keyword. */
  furnishedOnly: boolean;
  /** Zillow-style keyword terms — a listing must match every one. */
  keywords: string[];
}

export const DEFAULT_DEAL_FILTERS: DealFilters = {
  query: "",
  rentMin: 500,
  rentMax: 6000,
  beds: [],
  baths: [],
  types: TYPE_OPTIONS.map((t) => t.value),
  furnishedOnly: false,
  keywords: [],
};

export function isDefaultDealFilters(f: DealFilters): boolean {
  return (
    f.query === "" &&
    f.rentMin === DEFAULT_DEAL_FILTERS.rentMin &&
    f.rentMax === DEFAULT_DEAL_FILTERS.rentMax &&
    f.beds.length === 0 &&
    f.baths.length === 0 &&
    f.types.length === TYPE_OPTIONS.length &&
    !f.furnishedOnly &&
    f.keywords.length === 0
  );
}

/**
 * Loose, punctuation-blind matching: "water front" finds "Waterfront",
 * "washer dryer" finds "Washer & dryer". Both sides normalize the same way.
 */
export function normalizeKeyword(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Every US state abbreviation, so a two-letter token can be recognised
 * as one rather than treated as three letters of somebody's city.
 */
const STATE_CODES = new Set(
  ("al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms " +
    "mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv " +
    "wi wy dc").split(" ")
);

/**
 * Location matching that survives how people actually type: every
 * word/token of the query must appear in the market's haystack
 * ("name state code aliases", lowercased). "jacksonville florida",
 * "Jacksonville, FL", and plain "jacksonville" all find the same market;
 * "springfield mo" pins down one Springfield.
 *
 * A state abbreviation has to match as a WHOLE WORD, which the plain
 * substring test got wrong in a way nobody would guess: "Portland, OR"
 * also matched Portland, Maine, because "portland" contains an "or",
 * and "Lincoln, NE" also matched Lincoln, New Hampshire, through the
 * "ne" in "new". Two matches instead of one, and the Deal Finder only
 * loads live inventory when a search resolves to exactly one market —
 * so two of the course's own cities silently showed preview rows
 * forever. Anything that isn't a state code still matches as a
 * substring, which is what makes typing half a city name work.
 */
export function marketMatchesQuery(haystack: string, query: string): boolean {
  const tokens = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((t) =>
    STATE_CODES.has(t)
      ? new RegExp(`\\b${t}\\b`).test(haystack)
      : haystack.includes(t)
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
  icon: Icon,
  children,
}: {
  label: string;
  summary?: string;
  active: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Leading glyph, for the catch-all chip that has no one meaning. */
  icon?: typeof SlidersHorizontal;
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
          ) : Icon ? (
            <Icon aria-hidden className="size-3.5" />
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

/* ------------------------------------------------------------------ */
/* Panels                                                              */
/* ------------------------------------------------------------------ */

/** Monthly-rent tiers — the bands arbitrage hunters actually shop. */
const PRICE_TIERS: { label: string; sub: string; min: number; max: number }[] = [
  { label: "Under $1,500", sub: "entry", min: DEFAULT_DEAL_FILTERS.rentMin, max: 1500 },
  { label: "$1,500–2,500", sub: "core", min: 1500, max: 2500 },
  { label: "$2,500–4,000", sub: "premium", min: 2500, max: 4000 },
  { label: "$4,000+", sub: "top end", min: 4000, max: DEFAULT_DEAL_FILTERS.rentMax },
];

function PricePanel({
  applied,
  onApply,
  onClose,
}: {
  applied: DealFilters;
  onApply: (patch: Partial<DealFilters>) => void;
  onClose: () => void;
}) {
  const [range, setRange] = React.useState<[number, number]>([
    applied.rentMin,
    applied.rentMax,
  ]);

  return (
    <>
      <PanelBody>
        <div className="grid grid-cols-2 gap-1.5">
          {PRICE_TIERS.map((tier) => {
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
          <p className="text-xs text-muted-foreground">Monthly rent</p>
          <Slider
            value={range}
            onValueChange={(v) => setRange([v[0], v[1]] as [number, number])}
            min={DEFAULT_DEAL_FILTERS.rentMin}
            max={DEFAULT_DEAL_FILTERS.rentMax}
            step={50}
            className="mt-3"
            aria-label="Monthly rent range"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground tabular">
            <span>{fmtMoney(range[0])}</span>
            <span>
              {range[1] >= DEFAULT_DEAL_FILTERS.rentMax
                ? `${fmtMoney(DEFAULT_DEAL_FILTERS.rentMax)}+`
                : fmtMoney(range[1])}
            </span>
          </div>
        </div>
      </PanelBody>
      <PanelFooter
        onReset={() =>
          setRange([DEFAULT_DEAL_FILTERS.rentMin, DEFAULT_DEAL_FILTERS.rentMax])
        }
        onApply={() => {
          onApply({ rentMin: range[0], rentMax: range[1] });
          onClose();
        }}
      />
    </>
  );
}

/** The tile row itself, so beds and baths can share one panel without
 *  sharing one selection. */
function CountTiles({
  unit,
  selected,
  onToggle,
}: {
  unit: string;
  selected: number[];
  onToggle: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {selected.length === 0 ? `Any ${unit}` : `Exact ${unit}`}
      </p>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${COUNT_OPTIONS.length}, 1fr)` }}
      >
        {COUNT_OPTIONS.map(([v, label]) => {
          const on = selected.includes(v);
          return (
            <button
              key={v}
              type="button"
              aria-pressed={on}
              aria-label={`${label} ${unit}`}
              onClick={() => onToggle(v)}
              className={cn(
                "h-9 rounded-sm border text-sm transition-colors duration-150 tabular",
                on
                  ? "border-gold/50 bg-gold-fill/10 font-medium text-gold"
                  : "border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function toggleIn(current: number[], v: number): number[] {
  return current.includes(v)
    ? current.filter((x) => x !== v)
    : [...current, v].sort((a, b) => a - b);
}

/**
 * Beds and baths in one panel.
 *
 * They were two chips, which is two clicks and two popovers for a
 * single thought — "a two-bed with a proper bathroom". Every rental
 * portal pairs them for that reason. One Apply commits both, so the
 * list never reflows twice for one decision.
 */
function BedsBathsPanel({
  applied,
  onApply,
  onClose,
}: {
  applied: DealFilters;
  onApply: (patch: Partial<DealFilters>) => void;
  onClose: () => void;
}) {
  const [beds, setBeds] = React.useState<number[]>(applied.beds);
  const [baths, setBaths] = React.useState<number[]>(applied.baths);

  return (
    <>
      <PanelBody>
        <CountTiles
          unit="bedrooms"
          selected={beds}
          onToggle={(v) => setBeds((c) => toggleIn(c, v))}
        />
        <CountTiles
          unit="bathrooms"
          selected={baths}
          onToggle={(v) => setBaths((c) => toggleIn(c, v))}
        />
        <p className="text-[11px] text-muted-foreground">
          Pick as many as you like. Nothing selected means any.
        </p>
      </PanelBody>
      <PanelFooter
        onReset={() => {
          setBeds([]);
          setBaths([]);
        }}
        onApply={() => {
          onApply({ beds, baths });
          onClose();
        }}
      />
    </>
  );
}

function HomeTypePanel({
  applied,
  onApply,
  onClose,
}: {
  applied: DealFilters;
  onApply: (patch: Partial<DealFilters>) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = React.useState<PropertyType[]>(applied.types);

  const toggle = (t: PropertyType) =>
    setSelected((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );

  return (
    <>
      <PanelBody>
        <div className="space-y-1.5">
          {TYPE_OPTIONS.map((t) => {
            const on = selected.includes(t.value);
            return (
              <button
                key={t.value}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(t.value)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-sm border px-3 py-2 text-sm transition-colors duration-150",
                  on
                    ? "border-gold/50 bg-gold-fill/5 text-foreground"
                    : "border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-xs border",
                    on ? "border-gold/60 bg-gold-fill/10" : "border-border"
                  )}
                >
                  {on ? <Check className="size-3 text-gold" /> : null}
                </span>
                {t.label}
              </button>
            );
          })}
        </div>
      </PanelBody>
      <PanelFooter
        onReset={() => setSelected(TYPE_OPTIONS.map((t) => t.value))}
        onApply={() => {
          onApply({ types: selected });
          onClose();
        }}
      />
    </>
  );
}

/** Common tags for the keyword panel. Furnished isn't here — it has its
 *  own chip in the row (typing it as a keyword still works). */
const KEYWORD_SUGGESTIONS = [
  "Pet friendly",
  "Waterfront",
  "Private pool",
  "Mountain view",
  "Hot tub",
  "Renovated",
  "Garage",
  "Washer & dryer",
];

function KeywordsPanel({
  applied,
  onApply,
  onClose,
}: {
  applied: DealFilters;
  onApply: (patch: Partial<DealFilters>) => void;
  onClose: () => void;
}) {
  const [text, setText] = React.useState(applied.keywords.join(", "));

  const terms = React.useMemo(
    () =>
      text
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    [text]
  );

  const hasTerm = (kw: string) =>
    terms.some((t) => normalizeKeyword(t) === normalizeKeyword(kw));

  const toggleTerm = (kw: string) => {
    const next = hasTerm(kw)
      ? terms.filter((t) => normalizeKeyword(t) !== normalizeKeyword(kw))
      : [...terms, kw];
    setText(next.join(", "));
  };

  const apply = () => {
    // Dedupe on the normalized form; keep the user's own spelling.
    const seen = new Set<string>();
    const keywords = terms.filter((t) => {
      const n = normalizeKeyword(t);
      if (!n || seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    onApply({ keywords });
    onClose();
  };

  return (
    <>
      <PanelBody>
        <div>
          <Label htmlFor="df-keywords" className="text-xs text-muted-foreground">
            Keywords — comma-separated
          </Label>
          <Input
            id="df-keywords"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply();
            }}
            placeholder="furnished, waterfront…"
            className="mt-1.5 h-8"
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Searches each listing&apos;s description and tags. Every keyword
            must match, and spelling is forgiving — &ldquo;water
            front&rdquo; finds Waterfront.
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Common tags</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {KEYWORD_SUGGESTIONS.map((kw) => {
              const on = hasTerm(kw);
              return (
                <button
                  key={kw}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleTerm(kw)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors duration-150",
                    on
                      ? "border-gold/50 bg-gold-fill/10 font-medium text-gold"
                      : "border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  )}
                >
                  {kw}
                </button>
              );
            })}
          </div>
        </div>
      </PanelBody>
      <PanelFooter onReset={() => setText("")} onApply={apply} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The chip row                                                        */
/* ------------------------------------------------------------------ */

/** Exact counts, with the last one open-ended. */
const COUNT_OPTIONS: [number, string][] = [
  [1, "1"],
  [2, "2"],
  [3, "3"],
  [4, "4"],
  [5, "5+"],
];

/** "2 bd", "1, 2 bd", "5+ bd" — the chip has room for a few. */
/** "2 bd · 1+ ba", or just the half that is set. */
export function bedsBathsSummary(f: DealFilters): string | undefined {
  const parts = [countSummary(f.beds, "bd"), countSummary(f.baths, "ba")].filter(
    Boolean
  );
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function countSummary(values: number[], unit: string): string | undefined {
  if (values.length === 0) return undefined;
  const label = (v: number) => (v >= 5 ? "5+" : String(v));
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length <= 3
    ? `${sorted.map(label).join(", ")} ${unit}`
    : `${sorted.length} sizes`;
}


function priceSummary(f: DealFilters): string {
  const openLow = f.rentMin <= DEFAULT_DEAL_FILTERS.rentMin;
  const openHigh = f.rentMax >= DEFAULT_DEAL_FILTERS.rentMax;
  if (openLow && !openHigh) return `Under ${fmtMoney(f.rentMax)}`;
  if (!openLow && openHigh) return `${fmtMoney(f.rentMin)}+`;
  return `${fmtMoney(f.rentMin)}–${fmtMoney(f.rentMax)}`;
}

export function DealFilterChips({
  filters,
  onChange,
  featuresKnown = true,
}: {
  filters: DealFilters;
  onChange: (patch: Partial<DealFilters>) => void;
  /** False when the current results carry no amenity data — the
   *  Furnished toggle would report a false zero, so it turns off. */
  featuresKnown?: boolean;
}) {
  const [openPanel, setOpenPanel] = React.useState<string | null>(null);

  const priceActive =
    filters.rentMin > DEFAULT_DEAL_FILTERS.rentMin ||
    filters.rentMax < DEFAULT_DEAL_FILTERS.rentMax;
  const typesActive = filters.types.length < TYPE_OPTIONS.length;

  const chip = (id: string) => ({
    open: openPanel === id,
    onOpenChange: (open: boolean) => setOpenPanel(open ? id : null),
  });
  const close = () => setOpenPanel(null);

  return (
    <>
      {/* Where a rental portal puts "For rent", this product puts the
          question that actually changes the maths. A furnished unit can
          start its furnishing budget at zero, so it is the one filter
          worth a click rather than a panel — and when the source ships
          no amenity data it disables rather than filtering everything
          away and implying nothing is furnished. */}
      <button
        type="button"
        aria-pressed={filters.furnishedOnly}
        disabled={!featuresKnown}
        title={
          featuresKnown
            ? undefined
            : "This feed doesn't publish furnishing status — check the listing itself"
        }
        onClick={() => onChange({ furnishedOnly: !filters.furnishedOnly })}
        className={cn(
          "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors duration-150",
          !featuresKnown
            ? "cursor-not-allowed border-border text-muted-foreground/50"
            : filters.furnishedOnly
              ? "border-gold/50 bg-gold-fill/10 text-gold"
              : "border-border text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
        )}
      >
        {filters.furnishedOnly && featuresKnown ? (
          <Check aria-hidden className="size-3.5" />
        ) : null}
        Furnished
      </button>

      <FilterChip
        label="Price"
        active={priceActive}
        summary={priceSummary(filters)}
        {...chip("price")}
      >
        <PricePanel applied={filters} onApply={onChange} onClose={close} />
      </FilterChip>

      <FilterChip
        label="Beds & baths"
        active={filters.beds.length > 0 || filters.baths.length > 0}
        summary={bedsBathsSummary(filters)}
        {...chip("bedsbaths")}
      >
        <BedsBathsPanel applied={filters} onApply={onChange} onClose={close} />
      </FilterChip>

      <FilterChip
        label="Home type"
        active={typesActive}
        summary={
          filters.types.length === 1
            ? TYPE_LABEL[filters.types[0]]
            : `${filters.types.length} types`
        }
        {...chip("type")}
      >
        <HomeTypePanel applied={filters} onApply={onChange} onClose={close} />
      </FilterChip>

      {/* The catch-all, last, like every portal's. Keywords is what
          lives here today; anything narrower than a first-class chip
          belongs here as it arrives. */}
      <FilterChip
        label="Filters"
        icon={SlidersHorizontal}
        active={filters.keywords.length > 0}
        summary={
          filters.keywords.length > 1
            ? `${filters.keywords[0]} +${filters.keywords.length - 1}`
            : filters.keywords[0]
        }
        {...chip("more")}
      >
        <KeywordsPanel applied={filters} onApply={onChange} onClose={close} />
      </FilterChip>

    </>
  );
}
