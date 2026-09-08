"use client";

/**
 * Top-up packs, offered where a plan has just run dry.
 *
 * Sits beneath the plan cards in the upgrade modal rather than in
 * their place: the plan is the better deal at every size, and the
 * packs are priced to say so. A subscriber who is a few analyses
 * short in the last week of the month buys five; one who is buying
 * packs every month is looking at the row above.
 */

import * as React from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import {
  CREDIT_PACKS,
  PACK_ORDER,
  packUnitPrice,
  type PackId,
} from "@/config/app";
import { fmtMoney } from "@/lib/format";
import { useSession } from "@/components/providers/session-provider";
import { cn } from "@/lib/utils";

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
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {PACK_ORDER.map((id) => {
          const pack = CREDIT_PACKS[id];
          const busy = pending === id;
          return (
            <button
              key={id}
              type="button"
              disabled={pending !== null}
              onClick={() => void buy(id)}
              className={cn(
                "flex flex-col items-start rounded-md border px-3 py-2.5 text-left transition-colors duration-150 disabled:opacity-60",
                pack.recommended
                  ? "border-gold/60 bg-gold/[0.06] hover:bg-gold/10"
                  : "border-border bg-card hover:border-gold/40"
              )}
            >
              <span className="font-display text-lg font-medium leading-none tabular">
                {fmtMoney(pack.price)}
              </span>
              <span className="mt-1 text-xs text-foreground">{pack.label}</span>
              <span className="mt-0.5 text-[10px] text-muted-foreground tabular">
                {busy ? "Adding…" : `${fmtMoney(packUnitPrice(pack))} each`}
              </span>
              {pack.recommended ? (
                <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-gold">
                  <Check aria-hidden className="size-3" strokeWidth={2.5} />
                  Most picked
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
