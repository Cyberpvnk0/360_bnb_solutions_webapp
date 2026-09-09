import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type ChipTone = "gold" | "neutral" | "neg" | "outline";

interface StatusChipProps extends React.ComponentProps<"span"> {
  tone?: ChipTone;
}

/**
 * Rounded status chip — the one place pills are allowed.
 * Gold = positive signal. Muted red always ships with a warning icon so
 * the signal never rides on color alone. Full-saturation brand red is
 * never used here.
 *
 * OPAQUE, ALWAYS. The tints are mixed into the card colour rather than
 * laid over it at low alpha: a chip sits on a card's top edge ("Most
 * popular", "Best value") and a see-through one showed the border
 * running through its own text.
 */
export function StatusChip({
  tone = "neutral",
  className,
  children,
  ...props
}: StatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] whitespace-nowrap",
        tone === "gold" &&
          "border-gold-fill/40 bg-[color-mix(in_oklab,var(--color-gold-fill)_14%,var(--color-card))] text-gold",
        tone === "neutral" &&
          "border-border bg-secondary text-muted-foreground",
        tone === "neg" &&
          "border-neg/40 bg-[color-mix(in_oklab,var(--color-neg)_12%,var(--color-card))] text-neg",
        tone === "outline" && "border-border bg-card text-foreground",
        className
      )}
      {...props}
    >
      {tone === "neg" ? (
        <TriangleAlert aria-hidden className="size-2.5" strokeWidth={2.5} />
      ) : null}
      {children}
    </span>
  );
}
