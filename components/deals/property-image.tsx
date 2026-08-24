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

export function PropertyImage({
  listing,
  className,
}: {
  listing: RentalListing;
  className?: string;
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

  // A new listing in the same slot starts its own fallback chain.
  const [lastId, setLastId] = React.useState(listing.id);
  if (listing.id !== lastId) {
    setLastId(listing.id);
    setStage(first);
  }

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
        src={src}
        alt={`${listing.address}, ${listing.city}`}
        loading="lazy"
        className="size-full object-cover"
        onError={() => setStage(stage === "photo" ? "street" : "sketch")}
      />
      {stage === "street" ? (
        <span className="pointer-events-none absolute bottom-1.5 right-2 text-[9px] uppercase tracking-[0.14em] text-white/80 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
          Street View
        </span>
      ) : null}
    </div>
  );
}
