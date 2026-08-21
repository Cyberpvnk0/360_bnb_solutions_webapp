"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarCheck, Mail, MoveDownRight, Phone } from "lucide-react";
import { toast } from "sonner";
import { fmtDate, fmtMoney } from "@/lib/format";
import type { Landlord, StrPolicy } from "@/lib/mock/types";
import { PIPELINE_STAGES } from "@/lib/mock/types";
import { cn } from "@/lib/utils";
import { useSession } from "@/components/providers/session-provider";
import { MetricLabel } from "@/components/primitives/metric-label";
import { StatusChip } from "@/components/primitives/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { StrPolicyChip } from "./str-policy-chip";

const STAGE_LABEL = Object.fromEntries(
  PIPELINE_STAGES.map((s) => [s.id, s.label])
) as Record<string, string>;

const FIELD_LABEL = "text-xs font-normal text-muted-foreground";

interface LandlordSheetProps {
  landlord: Landlord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Right drawer: one landlord, editable in place, with their linked deals. */
export function LandlordSheet({ landlord, open, onOpenChange }: LandlordSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto bg-card sm:w-[420px] sm:max-w-[420px]"
      >
        {landlord ? <SheetBody key={landlord.id} landlord={landlord} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({ landlord }: { landlord: Landlord }) {
  const { deals, updateLandlord, linkLandlordToDeal } = useSession();

  const [draft, setDraft] = React.useState({
    name: landlord.name,
    company: landlord.company ?? "",
    phone: landlord.phone,
    email: landlord.email,
    units: String(landlord.unitsControlled),
    allowsStr: landlord.allowsStr,
    notes: landlord.notes,
  });
  // Remounts the link Select after each pick so the placeholder returns.
  const [linkKey, setLinkKey] = React.useState(0);

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const linkedDeals = deals.filter((d) => landlord.dealIds.includes(d.id));
  const unlinkedDeals = deals.filter((d) => !landlord.dealIds.includes(d.id));

  const canSave = draft.name.trim().length > 0;

  const handleLogContact = () => {
    updateLandlord(landlord.id, {
      lastContacted: new Date().toISOString().slice(0, 10),
    });
    toast.success("Contact logged");
  };

  const handleSave = () => {
    if (!canSave) return;
    const units = Math.round(Number(draft.units));
    updateLandlord(landlord.id, {
      name: draft.name.trim(),
      company: draft.company.trim() || undefined,
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      unitsControlled: Number.isFinite(units) && units >= 0 ? units : 0,
      allowsStr: draft.allowsStr,
      notes: draft.notes.trim(),
    });
    toast.success("Contact saved");
  };

  const handleLinkDeal = (dealId: string) => {
    const deal = deals.find((d) => d.id === dealId);
    linkLandlordToDeal(landlord.id, dealId);
    setLinkKey((k) => k + 1);
    toast.success("Deal linked", {
      description: deal ? `${deal.address} is now tied to ${landlord.name}.` : undefined,
    });
  };

  return (
    <div className="flex min-h-full flex-col">
      {/* Identity */}
      <div className="border-b border-border px-5 pt-5 pb-4">
        <SheetTitle className="pr-8 font-display text-xl font-medium tracking-tight text-foreground">
          {landlord.name}
        </SheetTitle>
        <SheetDescription className="mt-0.5 text-sm text-muted-foreground">
          {landlord.company ?? "Independent owner"}
        </SheetDescription>
        <div className="mt-2.5">
          <StrPolicyChip policy={landlord.allowsStr} />
        </div>
      </div>

      {/* Contact */}
      <div className="border-b border-border px-5 py-4">
        <MetricLabel>Contact</MetricLabel>
        <div className="mt-2.5 space-y-1.5">
          <a
            href={`tel:${landlord.phone.replace(/[^+\d]/g, "")}`}
            className="flex items-center gap-2 text-sm text-foreground transition-colors duration-150 hover:text-gold"
          >
            <Phone aria-hidden className="size-3.5 text-muted-foreground" />
            <span className="tabular">{landlord.phone}</span>
          </a>
          <a
            href={`mailto:${landlord.email}`}
            className="flex items-center gap-2 text-sm text-foreground transition-colors duration-150 hover:text-gold"
          >
            <Mail aria-hidden className="size-3.5 text-muted-foreground" />
            <span className="truncate">{landlord.email}</span>
          </a>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {landlord.lastContacted
              ? `Last contacted ${fmtDate(landlord.lastContacted)}`
              : "Never contacted"}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleLogContact}
          >
            <CalendarCheck aria-hidden className="size-3.5" />
            Log contact today
          </Button>
        </div>
      </div>

      {/* Editable details */}
      <div className="border-b border-border px-5 py-4">
        <MetricLabel>Details</MetricLabel>
        <div className="mt-3 space-y-3.5">
          <div className="space-y-1.5">
            <Label htmlFor="ll-name" className={FIELD_LABEL}>
              Name
            </Label>
            <Input
              id="ll-name"
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ll-company" className={FIELD_LABEL}>
              Company
            </Label>
            <Input
              id="ll-company"
              value={draft.company}
              onChange={(e) => set("company", e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ll-phone" className={FIELD_LABEL}>
                Phone
              </Label>
              <Input
                id="ll-phone"
                type="tel"
                value={draft.phone}
                onChange={(e) => set("phone", e.target.value)}
                className="tabular"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ll-email" className={FIELD_LABEL}>
                Email
              </Label>
              <Input
                id="ll-email"
                type="email"
                value={draft.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ll-units" className={FIELD_LABEL}>
                Units controlled
              </Label>
              <Input
                id="ll-units"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={draft.units}
                onChange={(e) => set("units", e.target.value)}
                className="tabular"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ll-str" className={FIELD_LABEL}>
                Allows STR
              </Label>
              <Select
                value={draft.allowsStr}
                onValueChange={(v) => set("allowsStr", v as StrPolicy)}
              >
                <SelectTrigger id="ll-str" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="negotiable">Negotiable</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ll-notes" className={FIELD_LABEL}>
              Notes
            </Label>
            <Textarea
              id="ll-notes"
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="How you met, what they care about, next step"
              rows={3}
            />
          </div>
          <Button className="w-full" onClick={handleSave} disabled={!canSave}>
            Save changes
          </Button>
        </div>
      </div>

      {/* Linked deals */}
      <div className="px-5 py-4">
        <MetricLabel>Linked deals</MetricLabel>
        {linkedDeals.length > 0 ? (
          <ul className="mt-2 -mx-2">
            {linkedDeals.map((deal) => (
              <li key={deal.id}>
                <Link
                  href="/pipeline"
                  className="flex items-center justify-between gap-3 rounded-sm px-2 py-2 transition-colors duration-150 hover:bg-secondary"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {deal.address}
                    </span>
                    <StatusChip tone="outline" className="mt-1">
                      {STAGE_LABEL[deal.stage]}
                    </StatusChip>
                  </span>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 text-sm tabular",
                      deal.netCashFlow >= 0 ? "text-gold" : "text-neg"
                    )}
                  >
                    {deal.netCashFlow < 0 ? (
                      <MoveDownRight aria-hidden className="size-3" />
                    ) : null}
                    {fmtMoney(deal.netCashFlow)}/mo
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No deals linked yet.</p>
        )}
        {unlinkedDeals.length > 0 ? (
          <Select key={linkKey} onValueChange={handleLinkDeal}>
            <SelectTrigger className="mt-3 w-full" aria-label="Link a deal">
              <SelectValue placeholder="Link a deal from your pipeline" />
            </SelectTrigger>
            <SelectContent>
              {unlinkedDeals.map((deal) => (
                <SelectItem key={deal.id} value={deal.id}>
                  {deal.address} · {STAGE_LABEL[deal.stage]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <div className="mt-auto border-t border-border px-5 py-3">
        <p className="text-xs text-muted-foreground">
          Added {fmtDate(landlord.createdAt)}
        </p>
      </div>
    </div>
  );
}
