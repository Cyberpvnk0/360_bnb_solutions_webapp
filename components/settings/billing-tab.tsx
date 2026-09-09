"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  TIERS,
  annualEffectiveMonthly,
  type TierId,
} from "@/config/app";
import { fmtDate, fmtMoneyCents, fmtNum } from "@/lib/format";
import {
  BillingToggle,
  PricingTiers,
  type BillingCycle,
} from "@/components/pricing/pricing-cards";
import { useSession } from "@/components/providers/session-provider";
import { PackPicker } from "@/components/upgrade/pack-picker";
import { StatusChip } from "@/components/primitives/status-chip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function BillingTab() {
  const { ready, user, tier, creditsUsed, creditLimit, credits, upgradeTo, openUpgrade } =
    useSession();
  const [billing, setBilling] = React.useState<BillingCycle>("annual");

  if (!ready || !user) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const isPaid = tier.priceMonthly > 0;
  // No processor yet, so no account has a billing cycle: a paid-tier
  // plan with none is complimentary, and the page must say so rather
  // than invent a charge from the list price.
  const complimentary = isPaid && user.billingCycle === null;
  const priceLine = !isPaid
    ? "$0 forever"
    : complimentary
      ? `Included — nothing is billed. Lists at ${fmtMoneyCents(tier.priceMonthly)}/mo.`
      : user.billingCycle === "annual"
        ? `${fmtMoneyCents(annualEffectiveMonthly(tier))}/mo, billed annually at ${fmtMoneyCents(tier.priceAnnual)}`
        : `${fmtMoneyCents(tier.priceMonthly)}/mo, billed monthly`;

  const usedFraction = creditLimit > 0 ? Math.min(1, creditsUsed / creditLimit) : 0;
  const exhausted = creditLimit > 0 && creditsUsed >= creditLimit;

  const handleSelect = async (tierId: TierId) => {
    const result = await upgradeTo(tierId);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(`Plan changed to ${TIERS[tierId].name}`);
  };

  return (
    <div className="space-y-8">
      {/* Current plan */}
      <section className="rounded-sm border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">
            Current plan
          </h2>
          {isPaid ? (
            <StatusChip tone="gold">{complimentary ? "Included" : "Active"}</StatusChip>
          ) : null}
        </div>
        <div className="p-6">
          <div className="font-display text-3xl font-semibold tracking-tight text-foreground">
            {tier.name}
          </div>
          <p className="mt-1 text-sm text-muted-foreground tabular">
            {priceLine}
          </p>
          {isPaid && user.periodEnd ? (
            <p className="mt-0.5 text-xs text-muted-foreground tabular">
              Renews {fmtDate(user.periodEnd)}
            </p>
          ) : null}
        </div>
      </section>

      {/* Credit usage */}
      <section className="rounded-sm border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">
            Credits this month
          </h2>
        </div>
        <div className="p-6">
          {creditLimit > 0 ? (
            <>
              <div className="h-1.5 w-full overflow-hidden rounded-sm bg-secondary">
                <div
                  className="h-full rounded-sm transition-all duration-150"
                  style={{
                    width: `${usedFraction * 100}%`,
                    background: exhausted ? "var(--red-muted)" : "var(--gold)",
                  }}
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground tabular">
                {fmtNum(Math.min(creditsUsed, creditLimit))} of {fmtNum(creditLimit)} used
                {user.periodEnd ? <> · resets {fmtDate(user.periodEnd)}</> : null}
                {credits > 0 ? (
                  <>
                    {" "}· <span className="text-gold">{fmtNum(credits)} pack</span>{" "}
                    {credits === 1 ? "credit" : "credits"} on your account, never expire
                  </>
                ) : null}
              </p>
              <PackPicker className="mt-5 border-t border-border pt-5" />
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                The Free plan includes no credits.
              </p>
              <Button onClick={() => openUpgrade({ reason: "credits" })}>
                Upgrade for credits
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Change plan */}
      <section className="rounded-sm border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Change plan
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Anything unlimited stays unlimited — that&apos;s the point.
            </p>
          </div>
          <BillingToggle billing={billing} onChange={setBilling} />
        </div>
        <div className="p-6">
          <PricingTiers
            billing={billing}
            compact={false}
            currentTierId={user.tier}
            onSelect={handleSelect}
          />
        </div>
      </section>
    </div>
  );
}
