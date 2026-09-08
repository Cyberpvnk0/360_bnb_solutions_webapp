"use client";

/**
 * The suggestion menu under an address box: street on the first line,
 * city, state and ZIP on the second, so what is being picked is never
 * in doubt. One component for every box, so they cannot drift apart.
 */

import { MapPin } from "lucide-react";
import type { AddressSuggestion } from "@/lib/live/address-suggest";
import { cn } from "@/lib/utils";

export function AddressSuggestionList({
  id,
  suggestions,
  highlighted,
  onHighlight,
  onChoose,
  footer,
  dense = false,
}: {
  id: string;
  suggestions: AddressSuggestion[];
  highlighted: number;
  onHighlight: (index: number) => void;
  onChoose: (s: AddressSuggestion) => void;
  footer?: React.ReactNode;
  /** The top-bar box is small; the entry form has room. */
  dense?: boolean;
}) {
  return (
    <div
      id={id}
      role="listbox"
      className="overflow-hidden rounded-sm border border-border bg-popover shadow-md"
    >
      {suggestions.map((s, i) => {
        const hot = i === highlighted;
        const secondary = [s.city, [s.state, s.zip].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(", ");
        return (
          <button
            key={`${s.source}|${s.address}`}
            type="button"
            role="option"
            aria-selected={hot}
            onMouseEnter={() => onHighlight(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChoose(s)}
            className={cn(
              "flex w-full items-start gap-2.5 text-left transition-colors duration-150",
              dense ? "px-3 py-2" : "px-3.5 py-2.5",
              hot ? "bg-secondary" : "hover:bg-secondary/60"
            )}
          >
            <MapPin
              aria-hidden
              className={cn("mt-0.5 size-3.5 shrink-0", hot ? "text-select" : "text-muted-foreground")}
            />
            <span className="min-w-0">
              <span className={cn("block truncate text-sm font-medium", hot ? "text-foreground" : "text-foreground/90")}>
                {s.street || s.address}
              </span>
              {secondary ? (
                <span className="block truncate text-xs text-muted-foreground tabular">{secondary}</span>
              ) : null}
            </span>
          </button>
        );
      })}
      {footer ? (
        <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
