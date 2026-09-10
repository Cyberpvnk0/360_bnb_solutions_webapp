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
    <div className={cn("min-w-0 px-4 py-4 sm:px-8 sm:py-6 sm:first:pl-0 sm:last:pr-0", className)}>
      <MetricLabel>{label}</MetricLabel>
      <div
        className={cn(
          "mt-2 truncate text-[1.75rem] leading-tight tracking-tight text-foreground tabular",
          serif ? "font-display font-bold" : "font-semibold"
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
 * figures separated by hairline dividers. Two by two on a phone, so
 * every figure is on screen; the row, scrolling if it must, above.
 */
export function StatHeader({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div className={cn("sm:overflow-x-auto", className)} {...props}>
      <div className="grid grid-cols-2 border-y border-border sm:flex sm:min-w-max sm:items-stretch sm:divide-x sm:divide-border [&>*]:border-border max-sm:[&>*:nth-child(even)]:border-l max-sm:[&>*:nth-child(n+3)]:border-t">
        {children}
      </div>
    </div>
  );
}
