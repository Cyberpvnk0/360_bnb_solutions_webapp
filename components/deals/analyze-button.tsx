"use client";

/**
 * The one button that turns an estimate into an analysis.
 *
 * A card that has not been analyzed shows a range, and this is how
 * the range becomes a figure: the button is the card's one filled,
 * gold control, so the eye lands on it. Once the property has been
 * analyzed the button steps back to an outline — the figure on the
 * card IS the analysis, and opening it again is a look, not a buy.
 *
 * One component for the card, the map dock and the panel, so the rule
 * lives in one place.
 */

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { analyzeHref } from "@/lib/live/analyze-href";
import type { RentalListing } from "@/lib/mock/types";
import { cn } from "@/lib/utils";

export function AnalyzeButton({
  listing,
  analyzed,
  className,
}: {
  listing: RentalListing;
  /** True when the property's own analysis is what the figures show. */
  analyzed: boolean;
  className?: string;
}) {
  return (
    <Button
      variant={analyzed ? "outline" : "default"}
      size="sm"
      asChild
      className={cn(
        analyzed
          ? // Outlined on a white card, the button vanished into it. A
            // soft shadow hugging the border lifts it just enough.
            "shadow-[0_1px_2px_rgba(16,16,18,0.08),0_2px_6px_rgba(16,16,18,0.08)] transition-shadow duration-150 hover:shadow-[0_2px_4px_rgba(16,16,18,0.1),0_4px_10px_rgba(16,16,18,0.1)]"
          : // Gold is the product's "this one" signal, and this is the
            // one thing to do with an estimate. A warm shadow, not a
            // glow: lifted, never lit. `grad-gold` is explicit because
            // the default variant carries the BRAND gradient, and a red
            // image under this button's dark ink is unreadable.
            "grad-gold bg-gold-fill text-[#1c1503] shadow-[0_1px_2px_rgba(16,16,18,0.1),0_3px_10px_rgba(227,179,65,0.35)] transition-[box-shadow,background-image] duration-150 hover:shadow-[0_2px_4px_rgba(16,16,18,0.12),0_5px_14px_rgba(227,179,65,0.45)]",
        className
      )}
    >
      <Link href={analyzeHref(listing)} target="_blank" rel="noopener">
        {analyzed ? (
          <>
            View analysis
            <ArrowRight aria-hidden className="size-3.5" />
          </>
        ) : (
          <>
            <Sparkles aria-hidden className="size-3.5" strokeWidth={2.25} />
            Run the numbers
          </>
        )}
      </Link>
    </Button>
  );
}
