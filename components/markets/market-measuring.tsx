"use client";

import { Loader2 } from "lucide-react";

/** Indeterminate: the provider does not report percentage or stage progress. */
export function MarketMeasuring({ name }: { name: string }) {
  return (
    <section role="status" aria-live="polite" className="mt-6 flex items-start gap-4 rounded-sm border border-gold/30 bg-card px-5 py-4 elev-card">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gold-fill/10 text-gold">
        <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">Analyzing {name}…</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Fetching headline figures, Through the year and Booked ahead.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          A first analysis usually takes 10–15 seconds; some markets take longer. Your figures will appear here as soon as they arrive.
        </p>
      </div>
    </section>
  );
}
