"use client";

/**
 * Fill in a market that nobody has measured.
 *
 * Most of the catalogue is a rule, a researched lease and a row of
 * dashes, because nothing pre-fetches a market: figures arrive when
 * somebody analyzes a property there or searches it in the Deal Finder.
 * Both of those are side effects of doing something else, which left no
 * way to simply say "measure this one" from the page that shows the
 * gap. This is that way.
 *
 * One billed call, one credit, and then the market is measured for
 * every account — so the price is paid once by whoever wanted it first,
 * not by everyone who reads it after.
 */

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { MARKET_MEASURE_CREDITS } from "@/config/app";
import type { StoredMarketStats } from "@/lib/db/market-store";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const MEASURE_PRICE = `${MARKET_MEASURE_CREDITS} ${
  MARKET_MEASURE_CREDITS === 1 ? "credit" : "credits"
}`;

export function MeasureMarketButton({
  slug,
  name,
  onMeasured,
  className,
  variant = "default",
  size = "sm",
  compact = false,
}: {
  slug: string;
  name: string;
  /** The figures that came back, so a caller holding rows can show
   *  them without a reload. */
  onMeasured?: (stats: StoredMarketStats, at: string | null) => void;
  className?: string;
  variant?: "default" | "brand" | "outline" | "secondary" | "ghost";
  size?: "sm" | "default";
  /** Inside a table cell: the word alone, with the price on the title.
   *  A column wide enough for "Measure · 1 credit" is a column taken
   *  off the market names beside it. */
  compact?: boolean;
}) {
  const { user, creditsRemaining, credits, openUpgrade, refreshUsage } = useSession();
  const [busy, setBusy] = React.useState(false);

  if (!user) return null;

  const affordable = creditsRemaining + credits >= MARKET_MEASURE_CREDITS;

  const run = async () => {
    // The server checks this too and is the actual gate; this one just
    // turns a refusal into the modal that can do something about it.
    if (!affordable) {
      openUpgrade({ reason: "credits" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/markets/measure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ market: slug }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            stats?: StoredMarketStats;
            at?: string | null;
            message?: string;
            reason?: string;
            charged?: number;
          }
        | null;
      if (res.status === 402 || data?.reason === "no-credits") {
        openUpgrade({ reason: "credits" });
        return;
      }
      if (!res.ok || !data?.ok || !data.stats) {
        toast.error(data?.message ?? "Those figures could not be fetched.");
        return;
      }
      onMeasured?.(data.stats, data.at ?? null);
      const charged = data.charged ?? 0;
      // What it cost, and nothing else. A toast is not the place to
      // explain how the store works.
      toast.success(`${name} measured`, {
        description:
          charged > 0
            ? `${charged} ${charged === 1 ? "credit" : "credits"}`
            : "No credits taken",
      });
      if (charged > 0) void refreshUsage();
    } catch {
      toast.error("Those figures could not be fetched.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={busy}
      title={`Measure ${name} — ${MEASURE_PRICE}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void run();
      }}
      aria-label={`Measure ${name}, ${MEASURE_PRICE}`}
      className={cn("gap-1.5", compact && "h-7 px-2 text-[11px]", className)}
    >
      {busy ? (
        <Loader2 aria-hidden className={compact ? "size-3 animate-spin" : "size-3.5 animate-spin"} />
      ) : (
        <Sparkles aria-hidden className={compact ? "size-3" : "size-3.5"} />
      )}
      {compact ? "Measure" : `Measure · ${MEASURE_PRICE}`}
    </Button>
  );
}
