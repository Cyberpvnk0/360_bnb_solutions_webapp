"use client";

/**
 * Bedrooms and baths, corrected where the answer is visible.
 *
 * These used to be asked for on a form before anything ran — three
 * questions standing between somebody and the thing they came for, two
 * of which the app frequently already knew. A listing from the Deal
 * Finder carries its own size; a typed address does not, so the common
 * shape is assumed, the numbers run, and the correction happens here
 * against a result you can watch change.
 *
 * The size lives in the URL, so changing it is a navigation: shareable,
 * reloadable, back-button-correct, and no state to keep in sync with
 * the projection it drives.
 *
 * Changing it DOES cost a fresh comp pull — a different size is a
 * different question for the feed — so this commits on an explicit
 * change rather than on every keystroke of a spinner.
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/primitives/status-chip";
import { cn } from "@/lib/utils";

const BEDROOMS = [0, 1, 2, 3, 4, 5, 6];
const BATHROOMS = ["1", "1.5", "2", "2.5", "3", "3.5", "4"];

export function SizeControl({
  bedrooms,
  bathrooms,
  assumed,
  className,
}: {
  bedrooms: number;
  bathrooms: number;
  /** True when nobody supplied a size and one was assumed. */
  assumed: boolean;
  className?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = React.useState(false);
  const [bd, setBd] = React.useState(bedrooms);
  const [ba, setBa] = React.useState(String(bathrooms));

  const dirty = bd !== bedrooms || Number(ba) !== bathrooms;

  const apply = () => {
    const next = new URLSearchParams(params.toString());
    next.set("bd", String(bd));
    next.set("ba", ba);
    router.push(`?${next}`);
    setOpen(false);
  };

  if (!open) {
    return (
      <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
        <StatusChip tone={assumed ? "gold" : "outline"}>{bedrooms} bd</StatusChip>
        <StatusChip tone={assumed ? "gold" : "outline"}>{bathrooms} ba</StatusChip>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:border-gold/50 hover:text-foreground"
        >
          <Pencil aria-hidden className="size-3" />
          {assumed ? "Not right? Set the size" : "Change size"}
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-end gap-3 rounded-sm border border-gold/40 bg-card p-3",
        className
      )}
    >
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Bedrooms
        </span>
        <select
          value={bd}
          onChange={(e) => setBd(Number(e.target.value))}
          className="h-8 rounded-sm border border-border bg-secondary/50 px-2 text-sm text-foreground"
        >
          {BEDROOMS.map((n) => (
            <option key={n} value={n}>
              {n === 0 ? "Studio" : n}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Baths
        </span>
        <select
          value={ba}
          onChange={(e) => setBa(e.target.value)}
          className="h-8 rounded-sm border border-border bg-secondary/50 px-2 text-sm text-foreground"
        >
          {BATHROOMS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <Button size="sm" className="gap-1.5" onClick={apply} disabled={!dirty}>
        <Check aria-hidden className="size-3.5" />
        Re-run
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      <p className="w-full text-[11px] text-muted-foreground">
        A different size is a different question for the comps, so this
        pulls a fresh set.
      </p>
    </div>
  );
}
