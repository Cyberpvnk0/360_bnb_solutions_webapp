"use client";

import * as React from "react";
import { Check } from "lucide-react";
import {
  TIER_ORDER,
  TIERS,
  annualEffectiveMonthly,
  annualSavings,
  type Tier,
  type TierId,
} from "@/config/app";
import { AnimatedNumber } from "@/components/primitives/animated-number";
import { StatusChip } from "@/components/primitives/status-chip";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { fmtMoneyCents } from "@/lib/format";
import { cn } from "@/lib/utils";

export type BillingCycle = "monthly" | "annual";

/** Monthly/annual toggle with the two-months-free chip. */
export function BillingToggle({
  billing,
  onChange,
  className,
}: {
  billing: BillingCycle;
  onChange: (b: BillingCycle) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span
        className={cn(
          "text-sm transition-colors duration-150",
          billing === "monthly" ? "text-foreground" : "text-muted-foreground"
        )}
      >
        Monthly
      </span>
      <Switch
        checked={billing === "annual"}
        onCheckedChange={(v) => onChange(v ? "annual" : "monthly")}
        aria-label="Bill annually"
      />
      <span
        className={cn(
          "text-sm transition-colors duration-150",
          billing === "annual" ? "text-foreground" : "text-muted-foreground"
        )}
      >
        Annual
      </span>
      <StatusChip tone="gold">2 months free</StatusChip>
    </div>
  );
}

function TierPrice({ tier, billing }: { tier: Tier; billing: BillingCycle }) {
  if (tier.priceMonthly === 0) {
    return (
      <div className="flex items-baseline gap-1">
        <span className="font-display text-4xl font-medium tracking-tight tabular">
          $0
        </span>
        <span className="text-sm text-muted-foreground">forever</span>
      </div>
    );
  }
  const effective =
    billing === "annual" ? annualEffectiveMonthly(tier) : tier.priceMonthly;
  return (
    <div>
      <div className="flex items-baseline gap-1">
        <AnimatedNumber
          value={effective}
          format={fmtMoneyCents}
          className="font-display text-4xl font-medium tracking-tight"
        />
        <span className="text-sm text-muted-foreground">/mo</span>
      </div>
      <div className="mt-1 min-h-4 text-xs text-muted-foreground">
        {billing === "annual" ? (
          <>
            billed annually at {fmtMoneyCents(tier.priceAnnual)} — save{" "}
            {fmtMoneyCents(annualSavings(tier))}/yr
          </>
        ) : (
          <>billed monthly</>
        )}
      </div>
    </div>
  );
}

interface PricingCardProps {
  tier: Tier;
  billing: BillingCycle;
  compact?: boolean;
  currentTierId?: TierId;
  ctaLabel?: (tier: Tier) => string;
  onSelect?: (tierId: TierId) => void;
}

export function PricingCard({
  tier,
  billing,
  compact = false,
  currentTierId,
  ctaLabel,
  onSelect,
}: PricingCardProps) {
  const isCurrent = currentTierId === tier.id;
  const recommended = Boolean(tier.recommended);
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-sm border bg-card p-5 transition-colors duration-150",
        recommended
          ? "border-gold-fill/60 md:-my-2 md:py-7"
          : "border-border",
        compact && "p-4"
      )}
    >
      {recommended ? (
        <StatusChip tone="gold" className="absolute -top-2.5 left-4">
          Most popular
        </StatusChip>
      ) : null}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-foreground">
          {tier.name}
        </h3>
        {isCurrent ? <StatusChip tone="outline">Current</StatusChip> : null}
      </div>
      {!compact ? (
        <p className="mt-1 min-h-8 text-xs text-muted-foreground">{tier.blurb}</p>
      ) : null}
      <div className={cn("mt-4", compact && "mt-3")}>
        <TierPrice tier={tier} billing={billing} />
      </div>
      <ul className={cn("mt-4 space-y-1.5", compact && "mt-3")}>
        {tier.features.map((f) => (
          <li
            key={f}
            className="flex items-start gap-2 text-xs text-muted-foreground"
          >
            <Check aria-hidden className="mt-0.5 size-3 shrink-0 text-gold" />
            <span>
              {f.startsWith("Unlimited") ? (
                <>
                  <span className="font-medium text-foreground">Unlimited</span>
                  {f.slice("Unlimited".length)}
                </>
              ) : (
                f
              )}
            </span>
          </li>
        ))}
      </ul>
      {onSelect ? (
        <Button
          className="mt-5 w-full"
          variant={recommended ? "default" : "outline"}
          disabled={isCurrent}
          onClick={() => onSelect(tier.id)}
        >
          {isCurrent
            ? "Your current plan"
            : ctaLabel
              ? ctaLabel(tier)
              : tier.priceMonthly === 0
                ? "Start free"
                : `Choose ${tier.name}`}
        </Button>
      ) : null}
    </div>
  );
}

interface PricingTiersProps {
  billing: BillingCycle;
  /** Skip the free card (upgrade contexts). */
  paidOnly?: boolean;
  compact?: boolean;
  currentTierId?: TierId;
  ctaLabel?: (tier: Tier) => string;
  onSelect?: (tierId: TierId) => void;
  className?: string;
}

/** The four (or three, paidOnly) tier cards. Pro carries the gold border. */
export function PricingTiers({
  billing,
  paidOnly = false,
  compact = false,
  currentTierId,
  ctaLabel,
  onSelect,
  className,
}: PricingTiersProps) {
  const ids = paidOnly ? TIER_ORDER.filter((t) => t !== "free") : TIER_ORDER;
  return (
    <div
      className={cn(
        "grid gap-4",
        ids.length === 4
          ? "sm:grid-cols-2 xl:grid-cols-4"
          : "sm:grid-cols-3",
        className
      )}
    >
      {ids.map((id) => (
        <PricingCard
          key={id}
          tier={TIERS[id]}
          billing={billing}
          compact={compact}
          currentTierId={currentTierId}
          ctaLabel={ctaLabel}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
