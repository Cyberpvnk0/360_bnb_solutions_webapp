"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { analyzeSearchHref } from "@/lib/live/analyze-href";
import { useSession } from "@/components/providers/session-provider";
import { AddressSuggestionList } from "./address-suggestion-list";
import {
  MIN_QUERY_LENGTH,
  resolveAddressPoint,
  resolveSuggestionPoint,
  useAddressSuggestions,
  type AddressSuggestion,
} from "./use-address-suggestions";

/**
 * The persistent top-bar address search — the product's primary flow.
 * Type an address, pick a suggestion, and the numbers run: the pick
 * goes straight to the result. It used to land on the entry form with
 * the address filled in and a button still to press, which was the
 * same question asked twice. "/" focuses it from anywhere.
 *
 * The plan is checked here, as the entry form checks it: an account
 * with no credits left gets the upgrade prompt and keeps its typing.
 * An address that cannot be placed goes to the entry form, which can
 * say so and take a second run at it.
 *
 * Suggestions arrive as you type — up to five, each with street, city,
 * state and ZIP — from lib/live/address-suggest through /api/geocode.
 */
export function AddressSearch({ className }: { className?: string }) {
  const router = useRouter();
  const { canSpend, spendCredit, openUpgrade } = useSession();
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

  /** Run the numbers on a placed address, or say why not. */
  const run = (place: {
    address: string;
    street?: string;
    city?: string;
    state?: string;
    point: { lat: number; lon: number } | null;
  }) => {
    setOpen(false);
    inputRef.current?.blur();
    if (!place.point) {
      // Could not be placed: the entry form can say so and try again.
      setQuery("");
      router.push(`/analyze?${new URLSearchParams({ address: place.address })}`);
      return;
    }
    if (!canSpend) {
      // The typing stays, so the address is still there after the
      // upgrade rather than needing to be found again.
      openUpgrade({ reason: "credits" });
      return;
    }
    spendCredit();
    setQuery("");
    router.push(analyzeSearchHref({ ...place, point: place.point }));
  };

  const choose = async (match: AddressSuggestion) => {
    setLocating(true);
    // Carry the coordinates through: the row the person clicked is
    // the place they meant, and geocoding its text again could land
    // somewhere else.
    const point = await resolveSuggestionPoint(match);
    setLocating(false);
    run({ ...match, point });
  };

  /** Enter on a typed line with nothing picked: place the line as is. */
  const submitTyped = async () => {
    const address = query.trim();
    if (address.length < MIN_QUERY_LENGTH) return;
    setLocating(true);
    const point = await resolveAddressPoint(address);
    setLocating(false);
    run({ address, point });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const s = showList ? suggestions[highlighted] : undefined;
      if (s) void choose(s);
      else if (!locating) void submitTyped();
      return;
    }
    if (!showList) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
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
        // See market-search: under 16px, Safari zooms the page in on
        // focus.
        className="h-9 w-full rounded-sm border border-border bg-secondary/50 pl-8 pr-8 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-select/50 md:h-8 md:text-sm"
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
                    : "Pick an address to run the numbers"
            }
          />
        </div>
      ) : null}
    </div>
  );
}
