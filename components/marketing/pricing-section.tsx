"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BillingToggle,
  PricingTiers,
  type BillingCycle,
} from "@/components/pricing/pricing-cards";
import { PackCards } from "@/components/pricing/pack-cards";

/**
 * The landing page's pricing band. Client component: the billing toggle
 * holds state (annual by default) and every card CTA routes into the app.
 */
export function PricingSection() {
  const router = useRouter();
  const [billing, setBilling] = React.useState<BillingCycle>("annual");

  return (
    <div className="mx-auto max-w-6xl px-4 md:px-8">
      <div className="flex flex-col items-center text-center">
        <h2 className="font-display text-3xl font-medium tracking-tight text-foreground md:text-4xl">
          Pricing that doesn&apos;t eat the spread
        </h2>
        <p className="mt-3 max-w-md text-sm text-muted-foreground">
          You pay for property analyses — the live comps behind a breakeven
          read — not for looking around.
        </p>
        <BillingToggle billing={billing} onChange={setBilling} className="mt-10" />
      </div>

      <PricingTiers
        billing={billing}
        onSelect={() => router.push("/dashboard")}
        className="mt-12"
      />

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Annual is two months free. The calculator is never metered, on any
        plan, including Free.
      </p>

      {/* The packs, under the plans and never in their place: every pack
          is priced above the plan rate at its size, so the row reads as
          "for the month you run short", which is what it is. */}
      <div className="mt-16 flex flex-col items-center text-center">
        <h3 className="font-display text-2xl font-medium tracking-tight text-foreground">
          Run short mid-month? Top up.
        </h3>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          One-time packs of analyses for any paid plan. They never expire and
          are spent only after your plan&apos;s monthly allowance.
        </p>
      </div>
      <PackCards
        className="mt-8"
        ctaLabel="Get started"
        onSelect={() => router.push("/settings?tab=billing")}
      />
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Buying packs every month? A bigger plan is cheaper per analysis, every
        time.
      </p>
    </div>
  );
}
