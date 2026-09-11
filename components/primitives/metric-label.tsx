import { InfoHint } from "./info-hint";
import { cn } from "@/lib/utils";

/**
 * Small, uppercase, wide-tracked, muted label above a figure.
 *
 * `hint` puts an "i" after it. Take it wherever the label is the name
 * of a calculation rather than a plain noun — "Cushion" and "RevPAR"
 * need one, "Address" does not.
 */
export function MetricLabel({
  className,
  children,
  hint,
  ...props
}: React.ComponentProps<"div"> & { hint?: React.ReactNode }) {
  const text =
    typeof children === "string" || typeof children === "number"
      ? String(children)
      : "this figure";
  return (
    <div className={cn("metric-label", hint ? "flex items-center gap-1.5" : "", className)} {...props}>
      {children}
      {hint ? <InfoHint label={text}>{hint}</InfoHint> : null}
    </div>
  );
}
