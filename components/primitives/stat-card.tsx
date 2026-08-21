import { cn } from "@/lib/utils";
import { MetricLabel } from "./metric-label";

interface StatCardProps {
  label: React.ReactNode;
  /** The figure. Pass an <AnimatedNumber /> for counting values. */
  value: React.ReactNode;
  /** Optional <DeltaIndicator /> or hint line under the figure. */
  sub?: React.ReactNode;
  /** Serif display face for hero figures. */
  serif?: boolean;
  className?: string;
}

/** One figure in a stat header row. Compose inside <StatHeader>. */
export function StatCard({ label, value, sub, serif, className }: StatCardProps) {
  return (
    <div className={cn("min-w-0 px-8 py-6 first:pl-0 last:pr-0", className)}>
      <MetricLabel>{label}</MetricLabel>
      <div
        className={cn(
          "mt-2 truncate text-[1.75rem] leading-tight tracking-tight text-foreground tabular",
          serif ? "font-display font-medium" : "font-semibold"
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-1.5">{sub}</div> : null}
    </div>
  );
}

/**
 * The fat horizontal stat row that opens market and property pages:
 * figures separated by hairline dividers. Scrolls horizontally on mobile
 * instead of wrapping, so nothing shifts.
 */
export function StatHeader({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div className={cn("overflow-x-auto", className)} {...props}>
      <div className="flex min-w-max items-stretch divide-x divide-border border-y border-border">
        {children}
      </div>
    </div>
  );
}
