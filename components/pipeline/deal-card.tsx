"use client";

import * as React from "react";
import { useDraggable } from "@dnd-kit/core";
import { Contact, MoveDownRight } from "lucide-react";
import { fmtMoney, fmtPct } from "@/lib/format";
import type { Deal } from "@/lib/mock/types";
import { MetricLabel } from "@/components/primitives/metric-label";
import { StatusChip } from "@/components/primitives/status-chip";
import { cn } from "@/lib/utils";

/**
 * Presentational deal card — rendered in a column, and again inside the
 * DragOverlay as the lifted copy (border-gold, raised surface, no shadow).
 */
export function DealCardContent({
  deal,
  overlay,
  className,
}: {
  deal: Deal;
  overlay?: boolean;
  className?: string;
}) {
  const negative = deal.netCashFlow < 0;
  return (
    <div
      className={cn(
        "rounded-sm border border-border bg-card p-3 transition-colors duration-150",
        overlay ? "border-gold bg-surface-2" : "hover:border-gold/40",
        className
      )}
    >
      <p className="truncate text-sm font-medium leading-snug text-foreground">
        {deal.address}
      </p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {deal.city}, {deal.stateCode}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <MetricLabel>Breakeven</MetricLabel>
          <p className="mt-0.5 text-sm font-semibold tabular text-foreground">
            {fmtPct(deal.breakevenOccupancy)}
          </p>
        </div>
        <div>
          <MetricLabel>Cash flow</MetricLabel>
          <p
            className={cn(
              "mt-0.5 flex items-center gap-1 text-sm font-semibold tabular",
              negative ? "text-neg" : "text-gold"
            )}
          >
            {negative ? (
              <MoveDownRight aria-hidden className="size-3 shrink-0" />
            ) : null}
            {fmtMoney(deal.netCashFlow)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <StatusChip tone="outline">{deal.bedrooms} bd</StatusChip>
        {deal.landlordIds.length > 0 ? (
          <span
            className="inline-flex items-center gap-1 text-[11px] tabular text-muted-foreground"
            aria-label={`${deal.landlordIds.length} landlord ${
              deal.landlordIds.length === 1 ? "contact" : "contacts"
            }`}
          >
            <Contact aria-hidden className="size-3" />
            {deal.landlordIds.length}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Draggable wrapper. The source card stays in place (dimmed) while the
 * DragOverlay carries the lifted copy. A plain click — under the pointer
 * sensor's 6px activation distance — opens the deal drawer.
 */
export function DraggableDealCard({
  deal,
  onOpen,
}: {
  deal: Deal;
  onOpen: (dealId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(deal.id)}
      className={cn(
        "cursor-grab touch-none rounded-sm",
        isDragging && "opacity-40"
      )}
      aria-label={`${deal.address} — open deal`}
    >
      <DealCardContent deal={deal} />
    </div>
  );
}
