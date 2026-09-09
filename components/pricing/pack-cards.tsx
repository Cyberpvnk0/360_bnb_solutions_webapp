"use client";

/**
 * The five top-up packs, as cards — presentational only.
 *
 * Shown in two places with two different buttons: on the landing page,
 * where picking one routes into the app; and inside the app, where
 * picking one buys it (see components/upgrade/pack-picker). One set of
 * cards, so the packs look the same on both, and the caller decides
 * what a click does.
 *
 * Same grammar as the tier cards beside them — rounded-sm, bg-card, the
 * gold chip on the recommended one — so the two rows read as one
 * pricing surface rather than two features glued together.
 */

import { CREDIT_PACKS, PACK_ORDER, type PackId } from "@/config/app";
import { fmtMoney } from "@/lib/format";
import { StatusChip } from "@/components/primitives/status-chip";
import { cn } from "@/lib/utils";

export function PackCards({
  onSelect,
  pendingId = null,
  disabled = false,
  ctaLabel = "Add to account",
  className,
}: {
  onSelect: (id: PackId) => void;
  /** The pack a purchase is in flight for; its card says so. */
  pendingId?: PackId | null;
  disabled?: boolean;
  ctaLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-3 lg:grid-cols-5", className)}>
      {PACK_ORDER.map((id) => {
        const pack = CREDIT_PACKS[id];
        const busy = pendingId === id;
        return (
          <button
            key={id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(id)}
            className={cn(
              "relative flex flex-col rounded-sm border bg-card p-4 text-left transition-colors duration-150 hover:border-gold/50 disabled:opacity-60",
              pack.recommended ? "border-gold-fill/60" : "border-border"
            )}
          >
            {pack.recommended ? (
              <StatusChip tone="gold" className="absolute -top-2.5 left-3">
                Best value
              </StatusChip>
            ) : null}
            <span className="font-display text-2xl font-semibold leading-none tabular">
              {fmtMoney(pack.price)}
            </span>
            <span className="mt-2 text-sm font-medium text-foreground">
              {pack.analyses} analyses
            </span>
            <span className="mt-3 text-xs font-medium text-gold">
              {busy ? "Adding…" : ctaLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}
