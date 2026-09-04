"use client";

/**
 * Out to the page where the pictures already live.
 *
 * We host no listing imagery at all. The card's picture is a Street
 * View or an aerial of the kerb; the interiors live on the listing
 * site, and this sends people there rather than copying anything here.
 *
 * ONE LABEL, TWO DESTINATIONS. When the row carries its own listing URL
 * this opens that property; when it doesn't, lib/live/listing-links
 * falls back to a quoted, site-scoped search that finds it. Both say
 * "View photos", because the button is named for what the reader is
 * after rather than for our plumbing, and a label that changes under
 * them is its own kind of noise. The hover title still says which one
 * it is, so the difference is available without being shouted.
 *
 * One component for all three surfaces, because the rule about WHEN to
 * show it is the interesting part and it should exist once:
 *
 *   - a real address, or nothing. Seeded preview inventory has
 *     plausible addresses for buildings that do not exist, and a search
 *     for one lands on a stranger's house.
 *   - a link, never an embed. Framing someone's photos inside our
 *     chrome is the thing a link is specifically not.
 *
 * The label says what the reader gets rather than where they are going,
 * and the arrow says they are leaving. Screen readers get the off-site
 * part in words, since they cannot see the arrow.
 */

import { ArrowUpRight } from "lucide-react";
import { photosLink, type Addressed } from "@/lib/live/listing-links";
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
  const dest = real ? photosLink(place) : null;
  if (!dest) return null;

  const onListing = dest.kind === "listing";

  return (
    <a
      href={dest.href}
      target="_blank"
      rel="noopener noreferrer"
      title={
        onListing
          ? "Opens this property's listing page"
          : "Searches the listing sites for this exact address"
      }
      // Cards open a detail panel on click; this must not do both.
      onClick={(e) => e.stopPropagation()}
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
      <ArrowUpRight aria-hidden className="size-3.5" />
      {/* The same words a sighted reader gets. A screen reader saying
          something the button does not say is a second label, not a
          better one. */}
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
