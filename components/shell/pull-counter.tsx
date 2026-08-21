"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { useSession } from "@/components/providers/session-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Top-bar pull meter: a small gold radial ring showing pulls used against
 * the tier limit. Free tier reads "0 of 0" and opens the upgrade modal.
 */
export function PullCounter({ className }: { className?: string }) {
  const { ready, tier, pullsUsed, pullLimit, openUpgrade } = useSession();

  if (!ready) {
    return <Skeleton className={cn("h-6 w-28", className)} />;
  }

  const frac = pullLimit > 0 ? Math.min(1, pullsUsed / pullLimit) : 0;
  const r = 7;
  const circumference = 2 * Math.PI * r;
  const isFree = tier.pullLimit === 0;
  const exhausted = !isFree && pullsUsed >= pullLimit;

  const ring = (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden className="shrink-0">
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--border)" strokeWidth="2" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke={exhausted ? "var(--red-muted)" : "var(--gold)"}
        strokeWidth="2"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - frac)}
        transform="rotate(-90 9 9)"
        style={{ transition: "stroke-dashoffset 300ms" }}
      />
    </svg>
  );

  const label = (
    <span className="text-xs text-muted-foreground">
      <span
        className={cn(
          "inline-flex items-center gap-1 font-medium tabular",
          exhausted ? "text-neg" : "text-foreground"
        )}
      >
        {exhausted ? (
          <TriangleAlert aria-hidden className="size-3" strokeWidth={2.5} />
        ) : null}
        {pullsUsed} of {pullLimit}
      </span>{" "}
      <span className="hidden md:inline">pulls</span>
    </span>
  );

  if (isFree || exhausted) {
    return (
      <button
        type="button"
        onClick={() => openUpgrade({ reason: "pulls" })}
        className={cn(
          "flex items-center gap-2 rounded-sm border border-border px-2.5 py-1.5 transition-colors duration-150 hover:border-gold/50 hover:bg-secondary/50",
          className
        )}
        aria-label="Address pulls used. Upgrade to get more."
      >
        {ring}
        {label}
        <span className="text-xs font-medium text-gold">Upgrade</span>
      </button>
    );
  }

  return (
    <Link
      href="/settings?tab=billing"
      className={cn(
        "flex items-center gap-2 rounded-sm border border-border px-2.5 py-1.5 transition-colors duration-150 hover:bg-secondary/50",
        className
      )}
      aria-label={`${pullsUsed} of ${pullLimit} address pulls used this period`}
    >
      {ring}
      {label}
    </Link>
  );
}
