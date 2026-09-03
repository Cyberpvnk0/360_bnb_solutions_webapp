/**
 * The verdict, as a pill on the photo.
 *
 * Every other number on a card is raw material. This is the one place
 * the product says what it thinks, so it says it in a word and never in
 * a colour: each grade ships an icon and a label, and the fill only
 * repeats what those two already carry. A screenshot, a colourblind
 * operator, and a printout all read the same thing.
 *
 * The colours are literal rather than theme tokens, and deliberately.
 * This sits on a photograph, and a photograph has no light mode — a
 * pill that inverts with the theme would be dark text on a dark roof
 * half the time. Fixed values against a known-bright pill are the
 * legible choice on both themes and on any image behind them.
 */

import { Minus, Sparkles, TrendingUp, TriangleAlert } from "lucide-react";
import type { DealGrade } from "@/lib/calc/deal-grade";
import { cn } from "@/lib/utils";

const LOOK: Record<
  DealGrade,
  { icon: typeof TrendingUp; className: string }
> = {
  // Gold is the product's "this one" signal; it is the only grade that
  // gets to use it.
  amazing: { icon: Sparkles, className: "bg-[#e3b341] text-[#1c1503]" },
  good: { icon: TrendingUp, className: "bg-white/95 text-[#101012]" },
  fair: { icon: Minus, className: "bg-white/90 text-[#4a4d57]" },
  // Quiet, not alarming. A thin deal is information, not an emergency,
  // and a page of red pills teaches people to stop reading them.
  bad: { icon: TriangleAlert, className: "bg-white/95 text-[#9e3e49]" },
};

export function DealBadge({
  grade,
  label,
  className,
}: {
  grade: DealGrade;
  label: string;
  className?: string;
}) {
  const { icon: Icon, className: look } = LOOK[grade];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold shadow-sm backdrop-blur-[2px]",
        look,
        className
      )}
    >
      <Icon aria-hidden className="size-3" strokeWidth={2.5} />
      {label}
    </span>
  );
}
