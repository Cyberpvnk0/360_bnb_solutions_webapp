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
import { PackPicker } from "./pack-picker";
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
  const { upgrade, closeUpgrade, upgradeTo, tier, user } = useSession();
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
          ? "Property analyses are a paid feature."
          : "You've used every analysis this month."
      : upgrade.reason === "markets"
        ? tier.marketLimit === 0
          ? "Live listings are a paid feature."
          : tier.id === "scale"
            ? `You've opened every one of this month's ${tier.marketLimit} markets.`
            : `You've opened ${tier.marketLimit} markets this month.`
        : upgrade.reason === "deals"
          ? "You've hit your saved deal limit."
          : upgrade.reason === "export"
            ? "Spreadsheet export is on the Scale plan."
            : "Get more room to run.";

  const subheading =
    upgrade.reason === "pulls"
      ? analysis
        ? `${analysis.address}, ${analysis.city} has a full breakeven read waiting — comps included.`
        : "Every analysis turns an address into a breakeven read backed by live comps."
      : upgrade.reason === "markets"
        ? tier.marketLimit === 0
          ? "What you're looking at is preview inventory. Paid plans open today's actual listings in every market, with live comps behind every analysis."
          : tier.id === "scale"
            ? `The ${tier.name} plan opens ${tier.marketLimit} distinct markets a month, and that is the largest plan there is. The markets you've already opened stay open; the count resets on the 1st.`
            : `The ${tier.name} plan opens ${tier.marketLimit} distinct markets a month. Move up to keep browsing — the ones you've opened stay open.`
      : upgrade.reason === "deals"
        ? `The ${tier.name} plan holds ${
            Number.isFinite(tier.savedDealLimit) ? tier.savedDealLimit : "unlimited"
          } deals. Move up to keep building your pipeline.`
        : upgrade.reason === "export"
          ? "Take your lead list, pipeline and landlord book with you as a CSV that opens in any spreadsheet. Scale includes it."
          : "The calculator stays unlimited on every plan. Paid plans add property analyses, more markets, and pipeline capacity.";

  const [switching, setSwitching] = React.useState<TierId | null>(null);

  const handleSelect = async (tierId: TierId) => {
    const completesPull = upgrade.reason === "pulls" && Boolean(analysis);
    setSwitching(tierId);
    // The tier is written server-side first; the toast reports what
    // actually happened rather than what was hoped for.
    const result = await upgradeTo(tierId, { consumePull: completesPull });
    setSwitching(null);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(`You're on ${TIERS[tierId].name} now`, {
      description:
        billing === "annual" ? "Billed annually. Two months free." : "Billed monthly.",
    });
    closeUpgrade();
    if (completesPull && analysis) {
      setTimeout(() => {
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
              className="pointer-events-none flex select-none items-center justify-center gap-12 px-8 py-8 blur-[7px]"
            >
              <BreakevenGauge
                breakeven={preview.breakeven}
                marketOccupancy={preview.marketOccupancy}
                size={150}
                strokeWidth={4}
              >
                <span className="font-display text-4xl font-semibold tabular">
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
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 border-t border-border bg-background/90 py-2.5 text-xs text-muted-foreground">
              <Lock aria-hidden className="size-3 text-gold" />
              Result computed. Unlock to see the full read.
            </div>
          </div>
        ) : null}

        <div className="p-7">
          <DialogHeader className="text-left">
            <DialogTitle className="font-display text-2xl font-semibold tracking-tight">
              {heading}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {subheading}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-6 flex items-center justify-between gap-4">
            <BillingToggle billing={billing} onChange={setBilling} />
          </div>

          <PricingTiers
            billing={billing}
            paidOnly
            compact
            currentTierId={user?.tier}
            onSelect={(id) => void handleSelect(id)}
            ctaLabel={(t) => (switching === t.id ? "Switching…" : `Choose ${t.name}`)}
            className="mt-6"
          />

          {/* A paid plan that has run dry can top up instead. Free
              cannot: a pack is for the month a plan runs out, and
              selling Free analyses by the dozen would undercut Starter. */}
          {upgrade.reason === "pulls" && tier.pullLimit > 0 ? (
            <PackPicker
              className="mt-6 border-t border-border pt-6"
              onBought={() => {
                closeUpgrade();
                if (analysis) {
                  setTimeout(() => router.push(`/analyze/${analysis.id}`), 150);
                }
              }}
            />
          ) : null}

          <p className="mt-6 text-center text-[11px] text-muted-foreground">
            Prices in USD. Change or cancel any time. The calculator stays
            unlimited on every plan.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
