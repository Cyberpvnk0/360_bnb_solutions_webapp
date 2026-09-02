"use client";

/**
 * A listing's picture, degrading honestly:
 *
 *   1. Street View of the address — the kerb — where Google has it
 *   2. an aerial — the roof and the lot — where it does not
 *   3. the seeded sketch, tagged for what it is
 *
 * Never the listing's own photo. A listing cannot carry one — the type
 * has no field for it — because a photo is copyrighted separately from
 * the facts around it and this product holds no licence to show one.
 * The card links to the listing's page instead and lets the source do
 * the showing.
 *
 * Preview inventory is invented, so it never gets imagery of a real
 * building at all: a sketch, tagged "Preview". Live rows hand their
 * coordinates to CurbShot, which walks the chain and labels the stage
 * that actually loaded.
 */

import type { RentalListing } from "@/lib/mock/types";
import { CurbShot, PropertyThumb } from "@/components/analyze/property-thumb";

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
  const isLive = listing.id.startsWith("live--");
  if (!isLive) {
    return (
      <PropertyThumb seed={listing.id} className={className} label="Preview" />
    );
  }
  return (
    <CurbShot
      seed={listing.id}
      point={{ lat: listing.lat, lon: listing.lon }}
      alt={`${listing.address}, ${listing.city}`}
      className={className}
      priority={priority}
    />
  );
}
