"use client";

/**
 * Top-up packs, offered where a plan has just run dry.
 *
 * Sits beneath the plan cards in the upgrade modal rather than in
 * their place: the plan is the better deal at every size, and the
 * packs are priced to say so. A subscriber who is a few analyses
 * short in the last week of the month buys five; one who is buying
 * packs every month is looking at the row above.
 *
 * The cards are components/pricing/pack-cards; this adds the buying.
 */

import * as React from "react";
import { toast } from "sonner";
import { CREDIT_PACKS, type PackId } from "@/config/app";
import { useSession } from "@/components/providers/session-provider";
import { PackCards } from "@/components/pricing/pack-cards";

export function PackPicker({
  onBought,
  className,
}: {
  /** Called with the new balance after a successful purchase. */
  onBought?: (balance: number) => void;
  className?: string;
}) {
  const { buyPack, credits } = useSession();
  const [pending, setPending] = React.useState<PackId | null>(null);

  const buy = async (id: PackId) => {
    setPending(id);
    const result = await buyPack(id);
    setPending(null);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    const pack = CREDIT_PACKS[id];
    toast.success(`${pack.analyses} analyses added`, {
      description: `${result.balance} on your account, on top of your plan.`,
    });
    onBought?.(result.balance);
  };

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-foreground">Or top up this month</p>
        {credits > 0 ? (
          <p className="text-xs text-muted-foreground tabular">
            {credits} pack {credits === 1 ? "analysis" : "analyses"} on your account
          </p>
        ) : null}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        One-time, never expire, spent after your plan&apos;s monthly allowance.
      </p>
      <PackCards
        className="mt-4"
        onSelect={(id) => void buy(id)}
        pendingId={pending}
        disabled={pending !== null}
      />
    </div>
  );
}
