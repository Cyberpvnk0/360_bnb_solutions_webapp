"use client";

/**
 * The measured figures the cards on screen are projected from.
 *
 * Asks app/api/market-figures for the city's figures and for the ZIPs
 * of the rows on screen, a batch at a time, and keeps every answer for
 * the session — a null answer included, since a ZIP the feed has
 * nothing for is not worth asking about again today. The rows are
 * re-read as answers land, so a card projected from the city's figures
 * a moment ago is projected from its ZIP's now.
 *
 * Nothing is asked for while the grid shows preview inventory: those
 * rows are modelled through and through, and the figures are a paid
 * account's.
 */

import * as React from "react";
import type { Figures } from "@/lib/live/market-figures";
import { zipOf } from "@/lib/live/zip";
import type { DealFigures } from "@/lib/mock/rentals";
import type { Market, RentalListing } from "@/lib/mock/types";

export interface WantedZip {
  zip: string;
  marketSlug: string;
  /** A point in the ZIP, for the feed's own lookup of its market. */
  point: { lat: number; lon: number };
}

export interface WantedFigures {
  markets: string[];
  zips: WantedZip[];
}

/** The areas a set of rows would be projected from. */
export function figuresWanted(listings: readonly RentalListing[]): WantedFigures {
  const markets = new Set<string>();
  const zips = new Map<string, WantedZip>();
  for (const l of listings) {
    markets.add(l.marketSlug);
    const zip = zipOf(l);
    if (zip && !zips.has(zip)) {
      zips.set(zip, { zip, marketSlug: l.marketSlug, point: { lat: l.lat, lon: l.lon } });
    }
  }
  return { markets: [...markets], zips: [...zips.values()] };
}

/** null: asked, and the feed had nothing. */
const marketCache = new Map<string, Figures | null>();
const zipCache = new Map<string, Figures | null>();
/** Markets with a request under way. */
const inFlight = new Set<string>();

const BATCH = 12;

export interface FigureSet {
  /** undefined: not asked yet. null: asked, nothing to be had. */
  market: (slug: string) => Figures | null | undefined;
  zip: (zip: string) => Figures | null | undefined;
  /** A request is under way somewhere. */
  pending: boolean;
}

async function ask(marketSlug: string, zips: WantedZip[]): Promise<void> {
  const params = new URLSearchParams({ market: marketSlug });
  if (zips.length > 0) {
    params.set("zips", zips.map((z) => z.zip).join(","));
    params.set(
      "points",
      zips.map((z) => `${z.zip}:${z.point.lat.toFixed(4)}:${z.point.lon.toFixed(4)}`).join(",")
    );
  }
  const nothing = () => {
    if (!marketCache.has(marketSlug)) marketCache.set(marketSlug, null);
    for (const z of zips) zipCache.set(z.zip, null);
  };
  try {
    const res = await fetch(`/api/market-figures?${params}`);
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      market?: Figures | null;
      zips?: Record<string, Figures | null>;
    } | null;
    if (!res.ok || !body?.ok) {
      nothing();
      return;
    }
    marketCache.set(marketSlug, body.market ?? null);
    for (const z of zips) zipCache.set(z.zip, body.zips?.[z.zip] ?? null);
  } catch {
    nothing();
  }
}

export function useMarketFigures(wanted: WantedFigures, enabled: boolean): FigureSet {
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);
  const latest = React.useRef(wanted);
  React.useEffect(() => {
    latest.current = wanted;
  }, [wanted]);
  const key = enabled
    ? `${wanted.markets.join("|")}#${wanted.zips.map((z) => z.zip).join("|")}`
    : "";

  React.useEffect(() => {
    if (!enabled) return;
    let live = true;
    const run = async () => {
      for (const slug of latest.current.markets) {
        if (inFlight.has(slug)) continue;
        inFlight.add(slug);
        try {
          // The city's figures ride along with the first batch of ZIPs;
          // whatever is still missing when a batch lands — the rows
          // may have grown meanwhile — goes in the next.
          for (;;) {
            const missing = latest.current.zips.filter(
              (z) => z.marketSlug === slug && !zipCache.has(z.zip)
            );
            if (marketCache.has(slug) && missing.length === 0) break;
            await ask(slug, missing.slice(0, BATCH));
            if (!live) return;
            rerender();
          }
        } finally {
          inFlight.delete(slug);
        }
        if (live) rerender();
      }
    };
    void run();
    return () => {
      live = false;
    };
    // The key is the wanted set; `latest` carries its current value.
  }, [key, enabled]);

  return {
    market: (slug) => marketCache.get(slug),
    zip: (zip) => zipCache.get(zip),
    pending: inFlight.size > 0,
  };
}

/**
 * The figures a row is projected from: its ZIP's, else its city's,
 * else none — with `pending` true while an answer is still on its way
 * for either, so the card can hold its numbers rather than show ones
 * about to change.
 */
export function dealFiguresFor(
  listing: RentalListing,
  market: Market,
  set: FigureSet
): { figures: DealFigures | null; pending: boolean } {
  const zip = zipOf(listing);
  const byZip = zip ? set.zip(zip) : null;
  if (byZip) {
    return {
      figures: { adr: byZip.adr, occupancy: byZip.occupancy, kind: "zip", area: zip ?? null, at: byZip.at },
      pending: false,
    };
  }
  const byCity = set.market(market.slug);
  if (byCity) {
    return {
      figures: {
        adr: byCity.adr,
        occupancy: byCity.occupancy,
        kind: "city",
        area: market.name,
        at: byCity.at,
      },
      pending: false,
    };
  }
  return { figures: null, pending: set.pending && (byZip === undefined || byCity === undefined) };
}

/** Tests only. */
export function resetFigureCaches(): void {
  marketCache.clear();
  zipCache.clear();
  inFlight.clear();
}
