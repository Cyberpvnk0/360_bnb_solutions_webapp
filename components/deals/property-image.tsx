"use client";

/**
 * A listing's picture, degrading honestly:
 *
 *   1. whatever imagery the server can draw for the coordinate — a
 *      Street View kerb shot where Google is working, an aerial otherwise
 *   2. the seeded sketch, tagged for what it is
 *
 * Never the listing's own photo. A listing cannot carry one — the type
 * has no field for it — because a photo is copyrighted separately from
 * the facts around it and this product holds no licence to show one.
 * The card links to the listing's page instead and lets the source do
 * the showing.
 *
 * Which of the imagery sources answered is a fact about the DEPLOYMENT,
 * not about this listing, so it is asked once per session and used only
 * to label the corner. The fallback happens in the browser via onError,
 * so a missing picture never blocks a render and a blocked network just
 * shows the sketch.
 */

import * as React from "react";
import type { RentalListing } from "@/lib/mock/types";
import { PropertyThumb } from "@/components/analyze/property-thumb";
import {
  imagerySources,
  propertyImageSrc,
  type ImagerySources,
} from "@/lib/live/property-imagery";
import { cn } from "@/lib/utils";

type Stage = "imagery" | "sketch";

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
  const first: Stage = isLive ? "imagery" : "sketch";
  const [stage, setStage] = React.useState<Stage>(first);
  const [loaded, setLoaded] = React.useState(false);
  const [sources, setSources] = React.useState<ImagerySources | null>(null);

  // A new listing in the same slot starts its own fallback chain.
  const [lastId, setLastId] = React.useState(listing.id);
  if (listing.id !== lastId) {
    setLastId(listing.id);
    setStage(first);
    setLoaded(false);
  }

  // Skip straight to the sketch when there is no imagery to ask for,
  // and learn which source will answer so the corner tag is honest.
  React.useEffect(() => {
    if (stage !== "imagery") return;
    let cancelled = false;
    imagerySources().then((got) => {
      if (cancelled) return;
      setSources(got);
      if (!got.street && !got.aerial) setStage("sketch");
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

  const src = propertyImageSrc(listing.lat, listing.lon);

  return (
    <div className={cn("relative overflow-hidden bg-secondary/60", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- served by
          our own route so the keys stay on the server; next/image would
          add a second hop for no benefit. */}
      <img
        key={src}
        src={src}
        alt={`${listing.address}, ${listing.city}`}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        // Off the main thread, so a batch of images arriving together
        // can't stutter the scroll while they decode.
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setStage("sketch")}
        className={cn(
          "size-full object-cover transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0"
        )}
      />
      {/* Say which it is. A roof labelled "Street View" is a small lie
          that makes somebody think the kerb shot is broken. */}
      {sources ? (
        <span className="pointer-events-none absolute bottom-1.5 right-2 text-[9px] uppercase tracking-[0.14em] text-white/80 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
          {sources.street ? "Street View" : "Aerial"}
        </span>
      ) : null}
    </div>
  );
}
