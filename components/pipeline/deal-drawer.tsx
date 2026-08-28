"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Mail, MoveDownRight, Phone } from "lucide-react";
import { toast } from "sonner";
import { fmtDate, fmtMoney, fmtPct } from "@/lib/format";
import {
  PIPELINE_STAGES,
  type Deal,
  type Landlord,
  type PipelineStage,
  type StrPolicy,
} from "@/lib/mock/types";
import { useSession } from "@/components/providers/session-provider";
import { MetricLabel } from "@/components/primitives/metric-label";
import { StatusChip } from "@/components/primitives/status-chip";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function stageLabel(stage: PipelineStage): string {
  return PIPELINE_STAGES.find((s) => s.id === stage)?.label ?? stage;
}

const STR_POLICY: Record<
  StrPolicy,
  { label: string; tone: "gold" | "outline" | "neg" }
> = {
  yes: { label: "Allows STR", tone: "gold" },
  negotiable: { label: "Negotiable", tone: "outline" },
  no: { label: "No STR", tone: "neg" },
};

function LandlordRow({ landlord }: { landlord: Landlord }) {
  const policy = STR_POLICY[landlord.allowsStr];
  return (
    <div className="rounded-sm border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {landlord.name}
          </p>
          {landlord.company ? (
            <p className="truncate text-xs text-muted-foreground">
              {landlord.company}
            </p>
          ) : null}
        </div>
        <StatusChip tone={policy.tone} className="shrink-0">
          {policy.label}
        </StatusChip>
      </div>
      <div className="mt-2 flex flex-col gap-1">
        <a
          href={`tel:+1${landlord.phone.replace(/\D/g, "")}`}
          className="inline-flex items-center gap-1.5 text-xs tabular text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <Phone aria-hidden className="size-3 shrink-0" />
          {landlord.phone}
        </a>
        <a
          href={`mailto:${landlord.email}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <Mail aria-hidden className="size-3 shrink-0" />
          {landlord.email}
        </a>
      </div>
    </div>
  );
}

function DealDrawerBody({ deal }: { deal: Deal }) {
  const { landlords, moveDeal, updateDeal, linkLandlordToDeal } = useSession();
  const [notes, setNotes] = React.useState(deal.notes);

  const linked = deal.landlordIds
    .map((id) => landlords.find((l) => l.id === id))
    .filter((l): l is Landlord => Boolean(l));
  const available = landlords.filter((l) => !deal.landlordIds.includes(l.id));
  const negative = deal.netCashFlow < 0;

  const handleStage = (value: string) => {
    const stage = value as PipelineStage;
    if (stage === deal.stage) return;
    moveDeal(deal.id, stage);
    toast(`Moved to ${stageLabel(stage)}`);
  };

  const handleSaveNotes = () => {
    updateDeal(deal.id, { notes });
    toast("Notes saved");
  };

  const handleLink = (landlordId: string) => {
    linkLandlordToDeal(landlordId, deal.id);
    const name = landlords.find((l) => l.id === landlordId)?.name;
    toast(name ? `Linked ${name}` : "Landlord linked");
  };

  return (
    <>
      <SheetHeader className="border-b border-border pr-12">
        <SheetTitle className="font-display text-xl font-medium leading-snug tracking-tight">
          {deal.address}
        </SheetTitle>
        <SheetDescription>
          {deal.city}, {deal.stateCode}
        </SheetDescription>
        <div>
          <StatusChip tone={deal.stage === "live" ? "gold" : "neutral"}>
            {stageLabel(deal.stage)}
          </StatusChip>
        </div>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        {/* Stage */}
        <div>
          <MetricLabel>Stage</MetricLabel>
          <Select value={deal.stage} onValueChange={handleStage}>
            <SelectTrigger className="mt-1.5 w-full" aria-label="Move deal to stage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PIPELINE_STAGES.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Figures */}
        <div className="grid grid-cols-2 divide-x divide-border rounded-sm border border-border">
          <div className="px-3 py-2.5">
            <MetricLabel>Breakeven</MetricLabel>
            <p className="mt-1 text-lg font-semibold tabular text-foreground">
              {fmtPct(deal.breakevenOccupancy)}
            </p>
          </div>
          <div className="px-3 py-2.5">
            <MetricLabel>Cash flow</MetricLabel>
            <p
              className={cn(
                "mt-1 flex items-center gap-1 text-lg font-semibold tabular",
                negative ? "text-neg" : "text-gold"
              )}
            >
              {negative ? (
                <MoveDownRight aria-hidden className="size-3.5 shrink-0" />
              ) : null}
              {fmtMoney(deal.netCashFlow)}
            </p>
          </div>
        </div>

        {/* Links */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/analyze/${deal.analysisId}`}>Open full analysis</Link>
          </Button>
          <Link
            href={`/deals?market=${deal.marketSlug}`}
            className="inline-flex items-center gap-0.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            Rentals here
            <ArrowUpRight aria-hidden className="size-3" />
          </Link>
        </div>

        {/* Notes */}
        <div>
          <MetricLabel>Notes</MetricLabel>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Terms discussed, repairs, timing…"
            className="mt-1.5 min-h-24"
            aria-label="Deal notes"
          />
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={handleSaveNotes}
            disabled={notes === deal.notes}
          >
            Save
          </Button>
        </div>

        {/* Landlords */}
        <div>
          <MetricLabel>Landlord</MetricLabel>
          <div className="mt-1.5 space-y-2">
            {linked.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No landlord linked yet
              </p>
            ) : (
              linked.map((l) => <LandlordRow key={l.id} landlord={l} />)
            )}
            {available.length > 0 ? (
              <Select key={deal.landlordIds.length} onValueChange={handleLink}>
                <SelectTrigger
                  size="sm"
                  className="w-full"
                  aria-label="Link a landlord to this deal"
                >
                  <SelectValue
                    placeholder={
                      linked.length > 0
                        ? "Link another landlord"
                        : "Link a landlord"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {available.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                      {l.company ? ` — ${l.company}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </div>
      </div>

      <div className="border-t border-border p-4 text-xs text-muted-foreground">
        Added {fmtDate(deal.createdAt)} · Updated {fmtDate(deal.updatedAt)}
      </div>
    </>
  );
}

/** Right-side drawer with the full working view of one deal. */
export function DealDrawer({
  deal,
  open,
  onOpenChange,
}: {
  deal: Deal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:w-[400px] sm:max-w-[400px]"
      >
        {deal ? <DealDrawerBody key={deal.id} deal={deal} /> : null}
      </SheetContent>
    </Sheet>
  );
}
