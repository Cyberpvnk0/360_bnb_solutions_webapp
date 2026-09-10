"use client";

/**
 * A property's own figures, for the panel: what the analyzer projects
 * from, when somebody has run it. Asked on open, kept for the session
 * by listing. A read of the store on the server, never a purchase.
 */

import * as React from "react";
import type { PropertyFigures } from "@/lib/live/property-figures";
import type { RentalListing } from "@/lib/mock/types";

export interface PropertyRead {
  status: "idle" | "looking" | "found" | "none";
  figures: PropertyFigures | null;
}

const answers = new Map<string, PropertyRead>();
const pending = new Map<string, Promise<PropertyRead>>();
const IDLE: PropertyRead = { status: "idle", figures: null };
const LOOKING: PropertyRead = { status: "looking", figures: null };

async function lookup(listing: RentalListing): Promise<PropertyRead> {
  const running = pending.get(listing.id);
  if (running) return running;
  const request = (async (): Promise<PropertyRead> => {
    try {
      const params = new URLSearchParams({
        lat: String(listing.lat),
        lon: String(listing.lon),
        bd: String(listing.bedrooms),
        ba: String(listing.bathrooms),
      });
      const res = await fetch(`/api/property-figures?${params}`);
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        figures?: PropertyFigures | null;
      } | null;
      if (!res.ok || !body?.ok || !body.figures) return { status: "none", figures: null };
      return { status: "found", figures: body.figures };
    } catch {
      return { status: "none", figures: null };
    }
  })();
  pending.set(listing.id, request);
  const settled = await request;
  pending.delete(listing.id);
  answers.set(listing.id, settled);
  return settled;
}

export function usePropertyFigures(listing: RentalListing | null, enabled: boolean): PropertyRead {
  const id = enabled && listing && listing.id.startsWith("live--") ? listing.id : null;
  const [, settled] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    if (!id || !listing || answers.has(id)) return;
    let live = true;
    void lookup(listing).then(() => {
      if (live) settled();
    });
    return () => {
      live = false;
    };
    // The listing is rebuilt each render; its id is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!id) return IDLE;
  return answers.get(id) ?? LOOKING;
}
