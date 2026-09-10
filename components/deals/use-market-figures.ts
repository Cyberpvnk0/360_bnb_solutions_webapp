"use client";

/**
 * The measured figures the cards on screen are projected from.
 *
 * Asks app/api/market-figures, a page of rows at a time, what each row
 * stands on — its own analysis, the real listings around it — and for
 * the city's figures, which a row falls to when nothing stands near
 * it. Every answer is kept for the session, a null answer included,
 * and the rows are re-read as answers land, so a card held blank a
 * moment ago is projected now.
 *
 * ASKED AGAIN, BEHIND WHAT IS ALREADY SHOWN. An analysis anyone runs
 * puts its set on file for every account's card, so a row that does
 * not yet stand on its own analysis is asked about again each time
 * the grid mounts or the tab comes back into view. The last answer
 * stays on the card meanwhile; nothing is asked twice for a row that
 * already stands on an analysis. Every ask is a read, never a purchase.
 *
 * Nothing is asked for while the grid shows preview inventory: those
 * rows are modelled through and through, and the figures are a paid
 * account's.
 */

import * as React from "react";
import type { CityFigures, RowFigures } from "@/app/api/market-figures/route";
import type { DealFigures } from "@/lib/calc/deal-read";
import type { Market, RentalListing } from "@/lib/mock/types";

export interface WantedRow {
  id: string;
  lat: number;
  lon: number;
  bd: number;
  ba: number;
  address: string;
  st: string;
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
      address: l.address,
      st: l.stateCode,
      marketSlug: l.marketSlug,
    });
  }
  return { markets: [...markets], rows };
}

/** null: asked, and there was nothing to be had. */
const marketCache = new Map<string, CityFigures | null>();
/** The last answer for a row, kept while a newer one is fetched. */
const rowCache = new Map<string, RowFigures | null>();
/** Rows answered since the last time the grid asked again. */
const answered = new Set<string>();
/** Markets with a request under way. */
const inFlight = new Set<string>();

const BATCH = 24;

export interface FigureSet {
  /** undefined: not asked yet. null: asked, nothing to be had. */
  market: (slug: string) => CityFigures | null | undefined;
  row: (id: string) => RowFigures | null | undefined;
  /** A request is under way somewhere. */
  pending: boolean;
}

async function ask(marketSlug: string, rows: WantedRow[]): Promise<void> {
  const nothing = () => {
    if (!marketCache.has(marketSlug)) marketCache.set(marketSlug, null);
    for (const r of rows) {
      if (!rowCache.has(r.id)) rowCache.set(r.id, null);
      answered.add(r.id);
    }
  };
  try {
    const res = await fetch("/api/market-figures", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        market: marketSlug,
        rows: rows.map(({ id, lat, lon, bd, ba, address, st }) => ({ id, lat, lon, bd, ba, address, st })),
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      market?: CityFigures | null;
      rows?: Record<string, RowFigures | null>;
    } | null;
    if (!res.ok || !body?.ok) {
      nothing();
      return;
    }
    marketCache.set(marketSlug, body.market ?? null);
    for (const r of rows) {
      rowCache.set(r.id, body.rows?.[r.id] ?? null);
      answered.add(r.id);
    }
  } catch {
    nothing();
  }
}

/** Every row not standing on its own analysis is asked about again;
 *  its last answer stays on the card until the new one lands. */
function askAgain(): boolean {
  let dropped = false;
  for (const id of answered) {
    if (rowCache.get(id)?.kind === "comps") continue;
    answered.delete(id);
    dropped = true;
  }
  return dropped;
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

  // Once on mount, and whenever the tab comes back into view: an
  // analysis run meanwhile — in another tab, by anyone — put its set
  // on file, and the card should stand on it.
  React.useEffect(() => {
    if (askAgain()) revisit();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (askAgain()) revisit();
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
          // whatever is still unanswered when a page lands — the rows
          // may have grown meanwhile — goes in the next.
          for (;;) {
            const missing = latest.current.rows.filter(
              (r) => r.marketSlug === slug && !answered.has(r.id)
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
 * The figures a row is projected from: its own analysis, else the
 * listings around it, else its city's, else none — with `pending` true
 * while an answer is still on its way, so the card can hold its
 * numbers rather than show ones about to change.
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
    // The area's rate for this size, worked out on the server —
    // measured from the market's own listings of this size when there
    // are enough, scaled from the city's average otherwise — so the
    // card does not scale it again.
    const rate = byCity.rates?.[Math.max(0, Math.round(listing.bedrooms))];
    return {
      figures: {
        adr: rate ?? byCity.adr,
        occupancy: byCity.occupancy,
        kind: "city",
        area: market.name,
        at: byCity.at,
        ...(rate ? { sized: true } : {}),
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
  answered.clear();
  inFlight.clear();
}
