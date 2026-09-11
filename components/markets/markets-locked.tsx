"use client";

/**
 * The market analyzer, seen from a plan that does not include it.
 *
 * Not a 404 and not a redirect: somebody who followed a link here
 * wanted this, and the honest answer is what it does and which plan has
 * it. The nav keeps the entry for the same reason — a feature nobody
 * can see is a feature nobody buys.
 */

import { ArrowUpRight, Globe2, Lock } from "lucide-react";
import { TIERS } from "@/config/app";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";

const WHAT = [
  "Every US market this product covers, with the local rule on nightly letting",
  "The map: where the strict states are, before you pick a city",
  "Inside a market — its ZIPs ranked by revenue, occupancy, listings and spread",
  "What size of unit clears the widest spread there",
  "Measure a market or one of its areas on demand",
];

export function MarketsLocked() {
  const { openUpgrade } = useSession();
  const plan = TIERS.scale;

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 md:px-6">
      <div className="rounded-sm border border-border bg-card p-8 elev-card md:p-10">
        <div className="flex size-10 items-center justify-center rounded-full bg-secondary">
          <Globe2 aria-hidden className="size-5 text-gold" />
        </div>
        <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight text-foreground">
          The market analyzer is on {plan.name}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The Deal Finder answers which property. This answers where — the one
          question a listing cannot, because a city&apos;s rule on nightly
          letting is not a fact about any unit in it.
        </p>

        <ul className="mt-6 space-y-2.5">
          {WHAT.map((line) => (
            <li key={line} className="flex gap-2.5 text-sm text-foreground">
              <ArrowUpRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-gold" />
              {line}
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button onClick={() => openUpgrade({ reason: "generic" })} className="gap-1.5">
            <Lock aria-hidden className="size-3.5" />
            See {plan.name}
          </Button>
          <span className="text-xs text-muted-foreground tabular">
            ${plan.priceMonthly}/mo · ${plan.priceAnnual}/yr
          </span>
        </div>
      </div>
    </div>
  );
}
