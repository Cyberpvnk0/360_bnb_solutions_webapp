"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { useSession } from "@/components/providers/session-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Top-bar credit meter: ONE number — the credits the account can still
 * spend, plan and packs together — beside a small gold ring showing how
 * much of the month's total that is. The split (plan left this month,
 * pack balance) sits on the title and on the billing page; the bar
 * says the thing a person actually wants to know, which is how many
 * they have.
 *
 * It used to read "35 of 300 credits +510": three numbers to add up in
 * the head for the one that mattered. Free reads "0 credits" and opens
 * the upgrade modal, as does a paid account that has run dry.
 */
export function PullCounter({ className }: { className?: string }) {
  const { ready, tier, creditsRemaining, creditLimit, credits, openUpgrade } =
    useSession();

  if (!ready) {
    return <Skeleton className={cn("h-6 w-24", className)} />;
  }

  const isFree = tier.creditLimit === 0;
  const packs = Math.max(0, credits);
  const left = creditsRemaining + packs;
  // Everything the month could offer — the plan's allowance plus the
  // packs on the account. The ring drains as that is spent.
  const total = creditLimit + packs;
  const frac = total > 0 ? Math.min(1, left / total) : 0;
  const r = 7;
  const circumference = 2 * Math.PI * r;
  const exhausted = !isFree && left <= 0;
  const breakdown = isFree
    ? "No credits on the Free plan"
    : `${creditsRemaining} of ${creditLimit} plan credits left this month` +
      (packs > 0 ? `, plus ${packs} pack credit${packs === 1 ? "" : "s"}` : "");

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
    <span className="text-xs whitespace-nowrap text-muted-foreground">
      <span
        className={cn(
          "inline-flex items-center gap-1 font-medium tabular",
          exhausted ? "text-neg" : "text-foreground"
        )}
      >
        {exhausted ? (
          <TriangleAlert aria-hidden className="size-3" strokeWidth={2.5} />
        ) : null}
        {left}
      </span>{" "}
      credits
    </span>
  );

  if (isFree || exhausted) {
    return (
      <button
        type="button"
        onClick={() => openUpgrade({ reason: "credits" })}
        title={breakdown}
        className={cn(
          "flex items-center gap-2 rounded-sm border border-border px-2.5 py-1.5 transition-colors duration-150 hover:border-gold/50 hover:bg-secondary/50",
          className
        )}
        aria-label={`${left} credits. Upgrade to get more.`}
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
      title={breakdown}
      className={cn(
        "flex items-center gap-2 rounded-sm border border-border px-2.5 py-1.5 transition-colors duration-150 hover:bg-secondary/50",
        className
      )}
      aria-label={`${left} credits left`}
    >
      {ring}
      {label}
    </Link>
  );
}
