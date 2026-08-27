"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MapPin, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The persistent top-bar address search — the product's primary flow.
 * Type an address, pick a suggestion, land on /analyze with it prefilled.
 * "/" focuses it from anywhere.
 *
 * Suggestions are real: the public federal geocoder, free and keyless,
 * so a keystroke costs nothing. This searched a hardcoded list of
 * invented addresses until now, and picking one handed the analyzer a
 * seeded id — the same stub the entry form had, in a second place, which
 * is exactly how a fake survives being fixed once.
 */

/** A geocoded place: the geocoder's own spelling, and where it is. */
interface AddressMatch {
  address: string;
  point: { lat: number; lon: number } | null;
}
export function AddressSearch({ className }: { className?: string }) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [query, setQuery] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<AddressMatch[]>([]);
  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(0);
  const [searching, setSearching] = React.useState(false);

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

  React.useEffect(() => {
    // The geocoder matches whole addresses rather than prefixes, so
    // firing on every character mostly buys empty results.
    if (query.trim().length < 4) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/geocode?q=${encodeURIComponent(query.trim())}`
        );
        const body = (await res.json()) as { matches?: AddressMatch[] };
        if (cancelled) return;
        const matches = body.matches ?? [];
        setSuggestions(matches);
        setOpen(matches.length > 0);
        setHighlighted(0);
      } catch {
        // A failed lookup is not a match; leave the list as it was.
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const choose = (match: AddressMatch) => {
    setOpen(false);
    setSuggestions([]);
    setQuery("");
    inputRef.current?.blur();
    // Carry the coordinates through. The entry form would otherwise
    // have to geocode the same string a second time, and could resolve
    // it differently than the row the user actually clicked.
    const params = new URLSearchParams({ address: match.address });
    if (match.point) {
      params.set("lat", String(match.point.lat));
      params.set("lon", String(match.point.lon));
    }
    router.push(`/analyze?${params}`);
  };

  const onQueryChange = (value: string) => {
    setQuery(value);
    if (value.trim().length < 4) {
      setSuggestions([]);
      setOpen(false);
      setSearching(false);
    } else {
      setSearching(true);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const s = suggestions[highlighted];
      if (s) choose(s);
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
        aria-expanded={open}
        aria-controls="address-search-listbox"
        aria-autocomplete="list"
        placeholder="Analyze an address…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={(e) => {
          if (!listRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
        }}
        className="h-8 w-full rounded-sm border border-border bg-secondary/50 pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-gold/50"
      />
      <kbd
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-xs border border-border px-1 text-[10px] text-muted-foreground"
      >
        /
      </kbd>

      {open ? (
        <div
          ref={listRef}
          id="address-search-listbox"
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-sm border border-border bg-popover"
        >
          {suggestions.map((s, i) => (
            <button
              key={`${s.address}|${s.point?.lat}`}
              type="button"
              role="option"
              aria-selected={i === highlighted}
              onMouseEnter={() => setHighlighted(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(s)}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors duration-150",
                i === highlighted ? "bg-secondary text-foreground" : "text-muted-foreground"
              )}
            >
              <MapPin aria-hidden className="size-3.5 shrink-0 text-gold" />
              <span className="truncate">{s.address}</span>
            </button>
          ))}
          <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            {searching ? "Searching…" : "Pick an address to start a projection"}
          </div>
        </div>
      ) : null}
    </div>
  );
}
