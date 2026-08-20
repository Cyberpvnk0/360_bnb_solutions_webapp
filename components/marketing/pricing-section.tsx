"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BillingToggle,
  PricingTiers,
  type BillingCycle,
} from "@/components/pricing/pricing-cards";

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
          Every plan browses every market. You pay for address pulls, not for
          looking around.
        </p>
        <BillingToggle billing={billing} onChange={setBilling} className="mt-8" />
      </div>

      <PricingTiers
        billing={billing}
        onSelect={() => router.push("/dashboard")}
        className="mt-10"
      />

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Annual is two months free. Unlimited means unlimited — market browsing
        and the calculator are never metered, on any plan, including Free.
      </p>
    </div>
  );
}
