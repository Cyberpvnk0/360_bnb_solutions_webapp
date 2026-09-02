"use client";

/**
 * The Deal Finder's front-and-center location search — Zillow's answer
 * to "show me Jacksonville": type a few letters, pick the market from
 * the suggestions, and the list, map, and live feed all snap to it.
 * Picking writes the canonical "Name, ST" query, which is guaranteed to
 * resolve to exactly one market (the live-mode trigger).
 */

import * as React from "react";
import { MapPin, Search, X } from "lucide-react";
import { fmtNum } from "@/lib/format";
import type { Market } from "@/lib/mock/types";
import { TERRAIN_LABEL } from "@/components/markets/market-banner";
import { marketSearchText } from "@/lib/mock/market-aliases";
import { marketMatchesQuery } from "./deal-filters";
import { cn } from "@/lib/utils";

interface MarketSearchBoxProps {
  markets: Market[];
  /** The applied location — a market query or "ZIP 32204". */
  applied: string;
  onApply: (query: string) => void;
  /** A 5-digit entry searches the live feed by ZIP. */
  onApplyZip: (zip: string) => void;
  className?: string;
}

export function MarketSearchBox({
  markets,
  applied,
  onApply,
  onApplyZip,
  className,
}: MarketSearchBoxProps) {
  const [text, setText] = React.useState(applied);
  const [focused, setFocused] = React.useState(false);
  // Keep the box in step when the query changes elsewhere (Location
  // panel, Reset all) — guarded adjust-state-during-render.
  const [lastApplied, setLastApplied] = React.useState(applied);
  if (applied !== lastApplied) {
    setLastApplied(applied);
    setText(applied);
  }

  const haystacks = React.useMemo(
    () =>
      markets.map((m) => ({
        market: m,
        hay: marketSearchText(m),
      })),
    [markets]
  );

  const trimmed = text.trim();
  const suggestions = React.useMemo(() => {
    if (trimmed.length < 2) return [];
    return haystacks
      .filter(({ hay }) => marketMatchesQuery(hay, trimmed))
      .slice(0, 8);
  }, [haystacks, trimmed]);

  const canonical = (m: Market) => `${m.name}, ${m.stateCode}`;
  const zipCandidate = /^\d{5}$/.test(trimmed) ? trimmed : null;
  const open =
    focused &&
    trimmed.length >= 2 &&
    (suggestions.length > 0 || zipCandidate !== null) &&
    trimmed !== applied;

  const pick = (m: Market) => {
    const q = canonical(m);
    setText(q);
    onApply(q);
    setFocused(false);
  };

  const pickZip = (zip: string) => {
    setText(`ZIP ${zip}`);
    onApplyZip(zip);
    setFocused(false);
  };

  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="deal-market-listbox"
        aria-label="Search a market"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          // Typing re-engages the box even when DOM focus never left it
          // (picking a suggestion keeps focus on the input).
          setFocused(true);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (zipCandidate) pickZip(zipCandidate);
            else if (suggestions.length > 0) pick(suggestions[0].market);
            else onApply(trimmed);
          }
          if (e.key === "Escape") setFocused(false);
        }}
        placeholder="Search a city or ZIP"
        className="h-8 w-64 rounded-full border border-border bg-surface pl-8 pr-8 text-xs text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:border-gold/50"
      />
      {text ? (
        <button
          type="button"
          aria-label="Clear market search"
          onClick={() => {
            setText("");
            onApply("");
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      ) : null}

      {open ? (
        <ul
          id="deal-market-listbox"
          role="listbox"
          aria-label="Matching markets"
          className="absolute left-0 top-10 z-40 w-80 overflow-hidden rounded-lg border border-border bg-popover py-1"
        >
          {zipCandidate ? (
            <li key="zip">
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickZip(zipCandidate);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-150 hover:bg-secondary/60"
              >
                <Search aria-hidden className="size-3.5 shrink-0 text-gold" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  Live rentals in ZIP{" "}
                  <span className="font-medium tabular">{zipCandidate}</span>
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  live feed
                </span>
              </button>
            </li>
          ) : null}
          {suggestions.map(({ market: m }) => (
            <li key={m.slug}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                // onMouseDown so the pick lands before the input blurs.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-150 hover:bg-secondary/60"
              >
                <MapPin aria-hidden className="size-3.5 shrink-0 text-gold" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {m.name}
                  <span className="text-muted-foreground">, {m.stateCode}</span>
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {TERRAIN_LABEL[m.terrain]} · {fmtNum(m.activeListings)} rentals
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
