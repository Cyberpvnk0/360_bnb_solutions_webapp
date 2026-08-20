"use client";

/**
 * /pipeline — the deal kanban. Five stages from first call to first guest;
 * cards drag between columns, click opens the working drawer.
 *
 * Session state flows exclusively through useSession(). The header sits in
 * the standard container; the board bleeds wider and scrolls horizontally.
 */

import * as React from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Columns3, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/format";
import {
  PIPELINE_STAGES,
  type Deal,
  type PipelineStage,
} from "@/lib/mock/types";
import { useSession } from "@/components/providers/session-provider";
import { EmptyState } from "@/components/primitives/empty-state";
import { PageHeader } from "@/components/primitives/page-header";
import { StatusChip } from "@/components/primitives/status-chip";
import { Button } from "@/components/ui/button";
import { DealCardContent, DraggableDealCard } from "./deal-card";
import { DealDrawer } from "./deal-drawer";
import { PipelineSkeleton } from "./pipeline-skeleton";
import { cn } from "@/lib/utils";

/** Pointer drags resolve by pointer position; keyboard drags fall back to
 *  rectangle intersection (there is no pointer to test). */
const collisionDetection: CollisionDetection = (args) => {
  const withPointer = pointerWithin(args);
  return withPointer.length > 0 ? withPointer : rectIntersection(args);
};

function BoardColumn({
  stage,
  label,
  deals,
  onOpen,
}: {
  stage: PipelineStage;
  label: string;
  deals: Deal[];
  onOpen: (dealId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const totalCashFlow = deals.reduce((sum, d) => sum + d.netCashFlow, 0);

  return (
    <section
      ref={setNodeRef}
      aria-label={`${label} — ${deals.length} deals`}
      className={cn(
        "flex min-w-[270px] flex-1 flex-col rounded-sm border border-transparent p-2 transition-colors duration-150",
        isOver && "border-gold/30 bg-secondary/40"
      )}
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="metric-label truncate">{label}</span>
          <StatusChip tone="neutral" className="tabular">
            {deals.length}
          </StatusChip>
        </div>
        <span className="shrink-0 text-[11px] tabular text-muted-foreground">
          {fmtMoney(totalCashFlow)} /mo
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2">
        {deals.length === 0 ? (
          <div className="flex min-h-[140px] flex-1 items-center justify-center rounded-sm border border-dashed border-border text-xs text-muted-foreground">
            Drop deals here
          </div>
        ) : (
          deals.map((deal) => (
            <DraggableDealCard key={deal.id} deal={deal} onOpen={onOpen} />
          ))
        )}
      </div>
    </section>
  );
}

export function PipelineBoard() {
  const { ready, deals, tier, openUpgrade, moveDeal } = useSession();
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [openDealId, setOpenDealId] = React.useState<string | null>(null);
  const suppressClickRef = React.useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  if (!ready) return <PipelineSkeleton />;

  const limit = tier.savedDealLimit;
  const atCapacity = Number.isFinite(limit) && deals.length >= limit;
  const activeDeal = activeId ? deals.find((d) => d.id === activeId) : null;
  const openDeal = openDealId
    ? deals.find((d) => d.id === openDealId) ?? null
    : null;

  const handleOpen = (dealId: string) => {
    if (suppressClickRef.current) return;
    setOpenDealId(dealId);
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    suppressClickRef.current = true;
  };

  const releaseClickSuppression = () => {
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 120);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    releaseClickSuppression();
    if (!over) return;
    const stage = over.id as PipelineStage;
    const deal = deals.find((d) => d.id === active.id);
    if (!deal || deal.stage === stage) return;
    moveDeal(deal.id, stage);
    const label = PIPELINE_STAGES.find((s) => s.id === stage)?.label ?? stage;
    toast(`Moved to ${label}`);
  };

  const handleDragCancel = () => {
    setActiveId(null);
    releaseClickSuppression();
  };

  return (
    <>
      {/* Header — standard container */}
      <div className="mx-auto max-w-6xl px-4 pt-6 md:px-8">
        <PageHeader
          title="Pipeline"
          description="Every deal from first call to first guest."
          actions={
            <p className="text-sm text-muted-foreground">
              <span className="font-medium tabular text-foreground">
                {deals.length}
              </span>{" "}
              of{" "}
              {Number.isFinite(limit) ? (
                <span className="tabular">{limit}</span>
              ) : (
                "unlimited"
              )}{" "}
              deals
            </p>
          }
        />

        {atCapacity ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-sm border border-border bg-secondary/40 px-3 py-2">
            <TriangleAlert aria-hidden className="size-4 shrink-0 text-neg" />
            <p className="text-sm text-foreground">
              Pipeline full on the {tier.name} plan
            </p>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => openUpgrade({ reason: "deals" })}
            >
              Upgrade
            </Button>
          </div>
        ) : null}
      </div>

      {deals.length === 0 ? (
        <div className="mx-auto max-w-6xl px-4 pb-10 md:px-8">
          <EmptyState
            className="mt-6"
            icon={Columns3}
            title="No deals yet"
            description="Run an address through the numbers, save it, and work it here from first call to first guest."
            action={
              <Button asChild>
                <Link href="/analyze">Analyze an address</Link>
              </Button>
            }
          />
        </div>
      ) : (
        /* Board — bleeds wider than the standard container */
        <div className="mt-6 px-4 pb-10 md:px-8">
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div className="overflow-x-auto pb-2">
              <div className="flex items-stretch gap-3">
                {PIPELINE_STAGES.map(({ id, label }) => (
                  <BoardColumn
                    key={id}
                    stage={id}
                    label={label}
                    deals={deals.filter((d) => d.stage === id)}
                    onOpen={handleOpen}
                  />
                ))}
              </div>
            </div>

            <DragOverlay dropAnimation={null}>
              {activeDeal ? (
                <DealCardContent
                  deal={activeDeal}
                  overlay
                  className="cursor-grabbing"
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}

      <DealDrawer
        deal={openDeal}
        open={openDeal !== null}
        onOpenChange={(open) => {
          if (!open) setOpenDealId(null);
        }}
      />
    </>
  );
}
