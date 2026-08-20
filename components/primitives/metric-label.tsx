import { cn } from "@/lib/utils";

/** Small, uppercase, wide-tracked, muted label above a figure. */
export function MetricLabel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("metric-label", className)} {...props} />;
}
