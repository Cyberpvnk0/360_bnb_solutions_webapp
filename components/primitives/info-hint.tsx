"use client";

/**
 * The small "i" beside a figure whose name is not its meaning.
 *
 * This product prints a lot of compressed finance: cushion in points,
 * breakeven occupancy, RevPAR, cash-on-cash. Every one of them is the
 * right word for the reader who already knows it and a blank for the
 * student who does not, and the student is who the product is for. A
 * sentence in the margin would answer it once and clutter the page for
 * ever; this answers it on demand and takes eleven pixels.
 *
 * REACHABLE WITHOUT A MOUSE. It is a button, not a bare icon with a
 * title attribute: hover opens it on a desktop, focus opens it from
 * the keyboard, and a tap opens it on a phone, where hover does not
 * exist and a title attribute never appears at all. The label is what
 * a screen reader announces, so it names the figure rather than saying
 * "more information" twenty times down a page.
 */

import * as React from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function InfoHint({
  label,
  children,
  className,
  side = "top",
}: {
  /** What this explains, for a screen reader: "Cushion". */
  label: string;
  /** The explanation. One or two plain sentences. */
  children: React.ReactNode;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen} delayDuration={120}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`What ${label} means`}
          // A tap has no hover to fall back on, so the press toggles it
          // too. Stopped, because these sit inside rows that open
          // things.
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className={cn(
            "inline-flex size-3.5 shrink-0 items-center justify-center rounded-full align-[-1px] text-muted-foreground/70 transition-colors duration-150 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40",
            className
          )}
        >
          <Info aria-hidden className="size-3.5" strokeWidth={2} />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        collisionPadding={12}
        className="max-w-[16rem] border-border bg-card text-[11px] font-normal leading-relaxed tracking-normal text-foreground normal-case shadow-lg"
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
