"use client";

/**
 * The photos on a listing's own page.
 *
 * A search row carries at most a thumbnail, so the full set is fetched
 * when the panel opens and never while browsing — a page of cards must
 * not turn into a page of billed requests. Until they arrive (or when
 * there are none) this is exactly the single image the card showed, so
 * the panel never opens on an empty frame.
 */

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { RentalListing } from "@/lib/mock/types";
import { PropertyImage } from "./property-image";
import { cn } from "@/lib/utils";

export function ListingGallery({
  listing,
  className,
  onDetail,
}: {
  listing: RentalListing;
  className?: string;
  /** The rest of what the listing's page carries — amenities and the
   *  published deposit — handed up so the panel can show them without
   *  a second billed request. */
  onDetail?: (detail: {
    amenities: string[];
    depositMin?: number;
    depositMax?: number;
  }) => void;
}) {
  const source = listing.sourceUrl;
  /** Photos we went and got; null until the fetch resolves. */
  const [fetched, setFetched] = React.useState<string[] | null>(null);
  /** Photos this image URL failed to load — dropped rather than shown
   *  as a broken frame. */
  const [broken, setBroken] = React.useState<string[]>([]);
  const [index, setIndex] = React.useState(0);

  // A different listing in the same slot resets during render, not in
  // an effect: a synchronous setState inside one cascades renders.
  // Assigned in an effect, never during render: the callback identity
  // must not restart the fetch.
  const onDetailRef = React.useRef(onDetail);
  React.useEffect(() => {
    onDetailRef.current = onDetail;
  }, [onDetail]);

  const [lastId, setLastId] = React.useState(listing.id);
  if (listing.id !== lastId) {
    setLastId(listing.id);
    setFetched(null);
    setBroken([]);
    setIndex(0);
  }

  const photos = (
    listing.photos?.length ? listing.photos : (fetched ?? [])
  ).filter((p) => !broken.includes(p));

  React.useEffect(() => {
    if (!source || (listing.photos?.length ?? 0) > 0) return;
    let cancelled = false;
    fetch(`/api/redfin/listing?url=${encodeURIComponent(source)}`)
      .then((res) => res.json())
      .then(
        (data: {
          ok?: boolean;
          photos?: string[];
          amenities?: string[];
          depositMin?: number;
          depositMax?: number;
        }) => {
          if (cancelled || !data?.ok) return;
          if (Array.isArray(data.photos)) setFetched(data.photos);
          if (Array.isArray(data.amenities) && data.amenities.length > 0) {
            onDetailRef.current?.({
              amenities: data.amenities,
              depositMin: data.depositMin,
              depositMax: data.depositMax,
            });
          }
        }
      )
      .catch(() => {
        // A gallery that won't load is not worth an error state: the
        // single card image below is already a correct answer.
      });
    return () => {
      cancelled = true;
    };
  }, [source, listing.photos]);

  if (photos.length === 0) {
    return <PropertyImage listing={listing} className={className} />;
  }

  const shown = photos[Math.min(index, photos.length - 1)];
  const step = (by: number) =>
    setIndex((i) => (i + by + photos.length) % photos.length);

  return (
    <div className={cn("relative shrink-0 overflow-hidden bg-secondary", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={shown}
        alt={`${listing.address} — photo ${index + 1} of ${photos.length}`}
        className="size-full object-cover"
        onError={() => setBroken((current) => [...current, shown])}
      />

      {photos.length > 1 ? (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={() => step(-1)}
            className="absolute left-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition-colors duration-150 hover:bg-black/65"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={() => step(1)}
            className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition-colors duration-150 hover:bg-black/65"
          >
            <ChevronRight aria-hidden className="size-4" />
          </button>
          <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium tabular text-white">
            {index + 1} / {photos.length}
          </span>
        </>
      ) : null}
    </div>
  );
}
