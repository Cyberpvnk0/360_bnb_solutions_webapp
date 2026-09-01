"use client";

/**
 * "View photos" — a menu of the places licensed to show them.
 *
 * We host no listing imagery at all. The card's picture is a Street
 * View of the kerb; the interiors live on the portals, and this sends
 * people there rather than copying anything here.
 *
 * One component for all three surfaces, because the rule about WHEN to
 * show it is the interesting part and it should exist once:
 *
 *   - a real address, or nothing. Seeded preview inventory has
 *     plausible addresses for buildings that do not exist, and a search
 *     for one lands on a stranger's house.
 *   - links, never embeds. Framing someone's photos inside our chrome
 *     is the thing a link is specifically not.
 *
 * The trigger says what the reader gets rather than where they are
 * going; the menu names the destinations, since that is the choice
 * being offered. Screen readers get the off-site part in words.
 */

import * as React from "react";
import { ArrowUpRight, ChevronDown, Images } from "lucide-react";
import { portalLinks, type Addressed } from "@/lib/live/listing-links";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function PhotosLink({
  place,
  /** False for seeded preview rows — their addresses are generated. */
  real,
  className,
  variant = "button",
}: {
  place: Addressed;
  real: boolean;
  className?: string;
  /**
   * "button" for an action row, "pill" for an overlay on an image,
   * "chip" for a quiet inline one on a page surface.
   */
  variant?: "button" | "pill" | "chip";
}) {
  const [open, setOpen] = React.useState(false);
  const links = real ? portalLinks(place) : [];
  if (links.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          // Cards open a detail panel on click; this must not do both.
          onClick={(e) => e.stopPropagation()}
          aria-label="View photos of this property on a listing site"
          className={cn(
            "inline-flex shrink-0 items-center gap-1 font-medium transition-colors duration-150",
            variant === "button" &&
              "h-8 rounded-sm border border-border px-3 text-sm text-foreground hover:bg-secondary/60",
            variant === "pill" &&
              "rounded-full bg-black/55 px-2.5 py-1 text-[11px] text-white backdrop-blur-[2px] hover:bg-black/70",
            variant === "chip" &&
              "rounded-full border border-border bg-secondary px-3 py-1 text-xs text-foreground hover:bg-secondary/70",
            className
          )}
        >
          View photos
          <ChevronDown aria-hidden className="size-3.5" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-56 p-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="px-2 pb-1.5 pt-1 text-[11px] leading-relaxed text-muted-foreground">
          Photos live on the listing sites. Opens in a new tab.
        </p>
        {links.map((link) => (
          <a
            key={link.id}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center justify-between gap-2 rounded-sm px-2 py-2 text-sm text-foreground transition-colors duration-150 hover:bg-secondary/60"
          >
            <span className="inline-flex items-center gap-2">
              <Images aria-hidden className="size-3.5 text-muted-foreground" />
              {link.label}
            </span>
            <ArrowUpRight aria-hidden className="size-3.5 text-muted-foreground" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ))}
      </PopoverContent>
    </Popover>
  );
}
