import { MoveDownRight, MoveRight, MoveUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface DeltaIndicatorProps {
  /** Signed change. Sign decides direction; you format the text. */
  value: number;
  /** Preformatted display text, e.g. "+4.2%" or "−$120". */
  label: string;
  /** Set when a falling number is good news (e.g. breakeven occupancy). */
  invert?: boolean;
  className?: string;
}

/**
 * Small signed-change marker. Gold = favorable, muted red + arrow icon =
 * unfavorable (the icon carries the signal so color never works alone).
 */
export function DeltaIndicator({
  value,
  label,
  invert = false,
  className,
}: DeltaIndicatorProps) {
  const flat = value === 0 || !Number.isFinite(value);
  const favorable = invert ? value < 0 : value > 0;
  const Icon = flat ? MoveRight : value > 0 ? MoveUpRight : MoveDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs tabular",
        flat ? "text-muted-foreground" : favorable ? "text-gold" : "text-neg",
        className
      )}
    >
      <Icon aria-hidden className="size-3" strokeWidth={2.25} />
      {label}
      <span className="sr-only">
        {flat ? "unchanged" : favorable ? "favorable" : "unfavorable"}
      </span>
    </span>
  );
}
