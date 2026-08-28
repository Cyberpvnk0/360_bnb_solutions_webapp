"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";
import { useSession } from "@/components/providers/session-provider";
import { AnimatedNumber } from "@/components/primitives/animated-number";
import { MetricLabel } from "@/components/primitives/metric-label";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const SIZE = 150;
const STROKE = 6;

/**
 * The desk's pull meter: a large gold radial ring — same technique as
 * BreakevenGauge (hairline track circle + arc via strokeDasharray) —
 * showing address pulls used against the tier limit. Free tier reads
 * "0 of 0" with a Get pulls action; an exhausted paid tier turns the arc
 * muted red with a warning line.
 */
export function PullRing({ className }: { className?: string }) {
  const { user, tier, pullsUsed, pullLimit, openUpgrade } = useSession();

  const isFree = tier.pullLimit === 0;
  const exhausted = !isFree && pullsUsed >= pullLimit;
  const frac = pullLimit > 0 ? Math.min(1, pullsUsed / pullLimit) : 0;

  const r = (SIZE - STROKE * 2 - 8) / 2;
  const c = SIZE / 2;
  const circumference = 2 * Math.PI * r;

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={cn("flex shrink-0 flex-col items-center gap-3", className)}>
      <div
        className="relative inline-flex items-center justify-center"
        style={{ width: SIZE, height: SIZE }}
        role="img"
        aria-label={
          isFree
            ? "No address pulls on the Free plan. Upgrade to get pulls."
            : `${pullsUsed} of ${pullLimit} address pulls used this period`
        }
      >
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
          {/* Hairline track */}
          <circle cx={c} cy={c} r={r} fill="none" stroke="var(--border)" strokeWidth={1} />
          {/* Usage arc, from 12 o'clock clockwise */}
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={exhausted ? "var(--red-muted)" : "var(--gold)"}
            strokeWidth={STROKE}
            strokeDasharray={circumference}
            strokeDashoffset={mounted ? circumference * (1 - frac) : circumference}
            transform={`rotate(-90 ${c} ${c})`}
            style={{
              transition:
                "stroke-dashoffset 600ms cubic-bezier(0.22,1,0.36,1), stroke 150ms",
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <AnimatedNumber
            value={pullsUsed}
            className="font-display text-4xl font-medium leading-none tracking-tight text-foreground"
          />
          <MetricLabel className="mt-1.5">of {pullLimit} pulls</MetricLabel>
        </div>
      </div>

      {exhausted ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-neg">
          <TriangleAlert aria-hidden className="size-3.5" strokeWidth={2.25} />
          Out of pulls
        </p>
      ) : null}

      {isFree || exhausted ? (
        <Button size="sm" onClick={() => openUpgrade({ reason: "pulls" })}>
          {isFree ? "Get pulls" : "Upgrade"}
        </Button>
      ) : null}

      {/* Narrowed on the date itself, not the tier: a free account has
          no period, and neither does a paid one before billing exists. */}
      {!isFree && user?.periodEnd ? (
        <p className="text-xs text-muted-foreground tabular">
          Resets {fmtDate(user.periodEnd)}
        </p>
      ) : null}
    </div>
  );
}
