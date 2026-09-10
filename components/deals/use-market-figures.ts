"use client";

/**
 * The measured figures the cards on screen are projected from.
 *
 * Asks app/api/market-figures, a page of rows at a time, what the real
 * listings around each row say — and for the city's figures, which a
 * row falls to when nothing stands near it. Every answer is kept for
 * the session, a null answer included: a row nothing stands near is
 * not asked about again on every render. The rows are re-read as
 * answers land, so a card held blank a moment ago is projected now.
 *
 * Nothing is asked for while the grid shows preview inventory: those
 * rows are modelled through and through, and the figures are a paid
 * account's.
 */

import * as React from "react";
import type { RowFigures } from "@/app/api/market-figures/route";
import type { DealFigures } from "@/lib/calc/deal-read";
import type { Figures } from "@/lib/live/market-figures";
import type { Market, RentalListing } from "@/lib/mock/types";

export interface WantedRow {
  id: string;
  lat: number;
  lon: number;
  bd: number;
  ba: number;
  marketSlug: string;
}

export interface WantedFigures {
  markets: string[];
  rows: WantedRow[];
}

/** The rows a set of listings would be projected from. */
export function figuresWanted(listings: readonly RentalListing[]): WantedFigures {
  const markets = new Set<string>();
  const rows: WantedRow[] = [];
  for (const l of listings) {
    markets.add(l.marketSlug);
    rows.push({
      id: l.id,
      lat: l.lat,
      lon: l.lon,
      bd: l.bedrooms,
      ba: l.bathrooms,
      marketSlug: l.marketSlug,
    });
  }
  return { markets: [...markets], rows };
}

/** null: asked, and there was nothing to be had. */
const marketCache = new Map<string, Figures | null>();
const rowCache = new Map<string, RowFigures | null>();
/** Markets with a request under way. */
const inFlight = new Set<string>();

const BATCH = 24;

export interface FigureSet {
  /** undefined: not asked yet. null: asked, nothing to be had. */
  market: (slug: string) => Figures | null | undefined;
  row: (id: string) => RowFigures | null | undefined;
  /** A request is under way somewhere. */
  pending: boolean;
}

async function ask(marketSlug: string, rows: WantedRow[]): Promise<void> {
  const nothing = () => {
    if (!marketCache.has(marketSlug)) marketCache.set(marketSlug, null);
    for (const r of rows) rowCache.set(r.id, null);
  };
  try {
    const res = await fetch("/api/market-figures", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        market: marketSlug,
        rows: rows.map(({ id, lat, lon, bd, ba }) => ({ id, lat, lon, bd, ba })),
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      market?: Figures | null;
      rows?: Record<string, RowFigures | null>;
    } | null;
    if (!res.ok || !body?.ok) {
      nothing();
      return;
    }
    marketCache.set(marketSlug, body.market ?? null);
    for (const r of rows) rowCache.set(r.id, body.rows?.[r.id] ?? null);
  } catch {
    nothing();
  }
}

export function useMarketFigures(wanted: WantedFigures, enabled: boolean): FigureSet {
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);
  const [visit, revisit] = React.useReducer((n: number) => n + 1, 0);
  const latest = React.useRef(wanted);
  React.useEffect(() => {
    latest.current = wanted;
  }, [wanted]);
  const key = enabled
    ? `${wanted.markets.join("|")}#${wanted.rows.map((r) => r.id).join("|")}`
    : "";

  // A row that had nothing to stand on is asked about again when the
  // tab comes back into view: an analysis run in another tab meanwhile
  // put its comp set on file, and the card should stand on it.
  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      let dropped = false;
      for (const [id, figures] of rowCache) {
        if (figures === null) {
          rowCache.delete(id);
          dropped = true;
        }
      }
      if (dropped) revisit();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  React.useEffect(() => {
    if (!enabled) return;
    let live = true;
    const run = async () => {
      for (const slug of latest.current.markets) {
        if (inFlight.has(slug)) continue;
        inFlight.add(slug);
        try {
          // The city's figures ride along with the first page of rows;
          // whatever is still missing when a page lands — the rows may
          // have grown meanwhile — goes in the next.
          for (;;) {
            const missing = latest.current.rows.filter(
              (r) => r.marketSlug === slug && !rowCache.has(r.id)
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
  }, [key, enabled, visit]);

  return {
    market: (slug) => marketCache.get(slug),
    row: (id) => rowCache.get(id),
    pending: inFlight.size > 0,
  };
}

/**
 * The figures a row is projected from: the listings around it, else
 * its city's, else none — with `pending` true while an answer is still
 * on its way, so the card can hold its numbers rather than show ones
 * about to change.
 */
export function dealFiguresFor(
  listing: RentalListing,
  market: Market,
  set: FigureSet
): { figures: DealFigures | null; pending: boolean } {
  const near = set.row(listing.id);
  if (near) {
    return {
      figures: {
        adr: near.adr,
        occupancy: near.occupancy,
        kind: near.kind,
        area: null,
        at: near.at,
        comps: near.comps,
        radiusMiles: near.radiusMiles,
      },
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
  return { figures: null, pending: set.pending && (near === undefined || byCity === undefined) };
}

/** Tests only. */
export function resetFigureCaches(): void {
  marketCache.clear();
  rowCache.clear();
  inFlight.clear();
}
