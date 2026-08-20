"use client";

/**
 * The upgrade modal — the product's core conversion surface.
 *
 * When a free or out-of-pulls user submits an address, this opens instead
 * of an error: the real result sits blurred behind the paywall with the
 * breakeven figure partially visible, and the paid tiers below.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { TIERS, type TierId } from "@/config/app";
import { breakevenOccupancy } from "@/lib/calc/arbitrage";
import { deriveMarketAssumptions } from "@/lib/calc/comps";
import { fmtPct } from "@/lib/format";
import { useSession } from "@/components/providers/session-provider";
import { BreakevenGauge } from "@/components/primitives/breakeven-gauge";
import { MetricLabel } from "@/components/primitives/metric-label";
import {
  BillingToggle,
  PricingTiers,
  type BillingCycle,
} from "@/components/pricing/pricing-cards";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function UpgradeModal() {
  const router = useRouter();
  const {
    upgrade,
    closeUpgrade,
    upgradeTo,
    consumePull,
    tier,
    user,
  } = useSession();
  const [billing, setBilling] = React.useState<BillingCycle>("annual");

  const analysis = upgrade.analysis;
  const preview = React.useMemo(() => {
    if (!analysis) return null;
    const assumptions = deriveMarketAssumptions(analysis.strComps);
    return {
      breakeven: breakevenOccupancy(analysis.defaults, assumptions),
      marketOccupancy: assumptions.marketOccupancy,
    };
  }, [analysis]);

  const heading =
    upgrade.reason === "pulls"
      ? analysis
        ? "Your projection is ready. Unlock it."
        : tier.id === "free"
          ? "Address pulls are a paid feature."
          : "You've used every pull this period."
      : upgrade.reason === "deals"
        ? "You've hit your saved deal limit."
        : "Get more room to run.";

  const subheading =
    upgrade.reason === "pulls"
      ? analysis
        ? `${analysis.address}, ${analysis.city} has a full breakeven read waiting — comps included.`
        : "Every pull turns an address into a breakeven read backed by live comps."
      : upgrade.reason === "deals"
        ? `The ${tier.name} plan holds ${
            Number.isFinite(tier.savedDealLimit) ? tier.savedDealLimit : "unlimited"
          } deals. Move up to keep building your pipeline.`
        : "Markets and the calculator stay unlimited on every plan. Paid plans add address pulls and pipeline capacity.";

  const handleSelect = (tierId: TierId) => {
    upgradeTo(tierId);
    toast.success(`You're on ${TIERS[tierId].name} now`, {
      description:
        billing === "annual" ? "Billed annually. Two months free." : "Billed monthly.",
    });
    closeUpgrade();
    // Complete the interrupted flow: spend the pull, open the result.
    if (upgrade.reason === "pulls" && analysis) {
      setTimeout(() => {
        consumePull();
        router.push(`/analyze/${analysis.id}`);
      }, 150);
    }
  };

  return (
    <Dialog open={upgrade.open} onOpenChange={(open) => !open && closeUpgrade()}>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-y-auto p-0 sm:max-w-3xl">
        {preview && analysis ? (
          <div className="relative overflow-hidden border-b border-border">
            {/* The real result, softened but recognizably there. */}
            <div
              aria-hidden
              className="pointer-events-none flex select-none items-center justify-center gap-10 px-8 py-6 blur-[7px]"
            >
              <BreakevenGauge
                breakeven={preview.breakeven}
                marketOccupancy={preview.marketOccupancy}
                size={150}
                strokeWidth={4}
              >
                <span className="font-display text-4xl font-medium tabular">
                  {fmtPct(preview.breakeven)}
                </span>
              </BreakevenGauge>
              <div className="hidden space-y-4 sm:block">
                <div>
                  <MetricLabel>Breakeven occupancy</MetricLabel>
                  <div className="font-display text-2xl tabular">
                    {fmtPct(preview.breakeven)}
                  </div>
                </div>
                <div>
                  <MetricLabel>Market occupancy</MetricLabel>
                  <div className="font-display text-2xl tabular">
                    {fmtPct(preview.marketOccupancy)}
                  </div>
                </div>
              </div>
            </div>
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background/95" />
            <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Lock aria-hidden className="size-3 text-gold" />
              Result computed. Unlock to see the full read.
            </div>
          </div>
        ) : null}

        <div className="p-6">
          <DialogHeader className="text-left">
            <DialogTitle className="font-display text-2xl font-medium tracking-tight">
              {heading}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {subheading}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 flex items-center justify-between gap-4">
            <BillingToggle billing={billing} onChange={setBilling} />
          </div>

          <PricingTiers
            billing={billing}
            paidOnly
            compact
            currentTierId={user?.tier}
            onSelect={handleSelect}
            className="mt-5"
          />

          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            Prices in USD. Change or cancel any time. Market browsing and the
            calculator stay unlimited on every plan, including Free.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
