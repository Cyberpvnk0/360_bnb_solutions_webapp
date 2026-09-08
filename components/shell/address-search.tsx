"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { AddressSuggestionList } from "./address-suggestion-list";
import {
  MIN_QUERY_LENGTH,
  resolveSuggestionPoint,
  useAddressSuggestions,
  type AddressSuggestion,
} from "./use-address-suggestions";

/**
 * The persistent top-bar address search — the product's primary flow.
 * Type an address, pick a suggestion, land on /analyze with it prefilled
 * and placed. "/" focuses it from anywhere.
 *
 * Suggestions arrive as you type — up to five, each with street, city,
 * state and ZIP — from lib/live/address-suggest through /api/geocode.
 */
export function AddressSearch({ className }: { className?: string }) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [locating, setLocating] = React.useState(false);

  const { suggestions, searching, noMatch } = useAddressSuggestions(query);
  const showList = open && query.trim().length >= MIN_QUERY_LENGTH;

  // The highlight belongs to one list: a new list starts from its first
  // row. Derived during render rather than reset in an effect.
  const [highlightFor, setHighlightFor] = React.useState<{
    list: AddressSuggestion[];
    index: number;
  } | null>(null);
  const highlighted = highlightFor?.list === suggestions ? highlightFor.index : 0;
  const setHighlighted = (next: number | ((h: number) => number)) =>
    setHighlightFor({
      list: suggestions,
      index: typeof next === "function" ? next(highlighted) : next,
    });

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target as HTMLElement | null)?.isContentEditable
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const choose = async (match: AddressSuggestion) => {
    setLocating(true);
    // Carry the coordinates through. The entry form would otherwise
    // have to geocode the same string a second time, and could resolve
    // it differently than the row the user actually clicked.
    const point = await resolveSuggestionPoint(match);
    setLocating(false);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    const params = new URLSearchParams({ address: match.address });
    if (point) {
      params.set("lat", String(point.lat));
      params.set("lon", String(point.lon));
    }
    router.push(`/analyze?${params}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!showList) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const s = suggestions[highlighted];
      if (s) void choose(s);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls="address-search-listbox"
        aria-autocomplete="list"
        placeholder="Analyze an address…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          if (!listRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
        }}
        className="h-8 w-full rounded-sm border border-border bg-secondary/50 pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-select/50"
      />
      {locating || searching ? (
        <Loader2
          aria-hidden
          className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
        />
      ) : (
        <kbd
          aria-hidden
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-xs border border-border px-1 text-[10px] text-muted-foreground"
        >
          /
        </kbd>
      )}

      {showList ? (
        <div ref={listRef} className="absolute left-0 right-0 top-full z-50 mt-1">
          <AddressSuggestionList
            id="address-search-listbox"
            dense
            suggestions={suggestions}
            highlighted={highlighted}
            onHighlight={setHighlighted}
            onChoose={(s) => void choose(s)}
            footer={
              locating
                ? "Placing that address…"
                : searching && suggestions.length === 0
                  ? "Searching…"
                  : noMatch
                    ? "No address matches yet — keep typing, or add the city."
                    : "Pick an address to start a projection"
            }
          />
        </div>
      ) : null}
    </div>
  );
}
