"use client";

/**
 * A listing's picture, degrading honestly: the feed's own photo if it
 * carries one, otherwise Google Street View of the address, otherwise
 * the seeded sketch tagged for what it is. Every fallback happens in
 * the browser via onError, so a missing photo never blocks a render and
 * a blocked network just shows the sketch.
 */

import * as React from "react";
import type { RentalListing } from "@/lib/mock/types";
import { PropertyThumb } from "@/components/analyze/property-thumb";
import { cn } from "@/lib/utils";

type Stage = "photo" | "street" | "sketch";

/**
 * Whether Street View is wired up at all, asked once per session.
 *
 * Without this every photo-less card fires its own request to find out,
 * so a page of twenty-four spends twenty-four round trips discovering
 * the same thing — and on a deployment with no Google key, discovering
 * nothing. One request now answers for the whole session.
 */
let streetViewProbe: Promise<boolean> | null = null;
function streetViewConfigured(): Promise<boolean> {
  streetViewProbe ??= fetch("/api/street-view?probe=1")
    .then((r) => (r.ok ? r.json() : { configured: false }))
    .then((d: { configured?: boolean }) => Boolean(d?.configured))
    .catch(() => false);
  return streetViewProbe;
}

export function PropertyImage({
  listing,
  className,
  /** Above the fold. Loads eagerly and asks the browser to hurry —
   *  the default of lazy tells it to deprioritise, which on the cards
   *  already on screen is precisely backwards. */
  priority = false,
}: {
  listing: RentalListing;
  className?: string;
  priority?: boolean;
}) {
  // Preview inventory is invented, so never dress it in a real photo of
  // a real building — only live rows earn curb imagery.
  const isLive = listing.id.startsWith("live--");
  const first: Stage = listing.photoUrl
    ? "photo"
    : isLive
      ? "street"
      : "sketch";
  const [stage, setStage] = React.useState<Stage>(first);
  const [loaded, setLoaded] = React.useState(false);

  // A new listing in the same slot starts its own fallback chain.
  const [lastId, setLastId] = React.useState(listing.id);
  if (listing.id !== lastId) {
    setLastId(listing.id);
    setStage(first);
    setLoaded(false);
  }

  // Skip straight to the sketch when there is no Street View to ask for.
  React.useEffect(() => {
    if (stage !== "street") return;
    let cancelled = false;
    streetViewConfigured().then((ok) => {
      if (!cancelled && !ok) setStage("sketch");
    });
    return () => {
      cancelled = true;
    };
  }, [stage]);

  if (stage === "sketch") {
    return (
      <PropertyThumb
        seed={listing.id}
        className={className}
        label={isLive ? "No photo" : "Preview"}
      />
    );
  }

  const src =
    stage === "photo"
      ? listing.photoUrl!
      : `/api/street-view?lat=${listing.lat}&lon=${listing.lon}`;

  return (
    <div className={cn("relative overflow-hidden bg-secondary/60", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- remote
          hosts vary by feed; next/image would need every one allow-listed. */}
      <img
        key={src}
        src={src}
        alt={`${listing.address}, ${listing.city}`}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        // Off the main thread, so a batch of photos arriving together
        // can't stutter the scroll while they decode.
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setStage(stage === "photo" ? "street" : "sketch")}
        className={cn(
          "size-full object-cover transition-opacity duration-300",
          // Photos land after the rows they belong to, so they fade up
          // out of the placeholder rather than snapping in.
          loaded ? "opacity-100" : "opacity-0"
        )}
      />
      {stage === "street" ? (
        <span className="pointer-events-none absolute bottom-1.5 right-2 text-[9px] uppercase tracking-[0.14em] text-white/80 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
          Street View
        </span>
      ) : null}
    </div>
  );
}
