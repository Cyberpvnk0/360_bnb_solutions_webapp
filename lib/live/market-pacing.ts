/**
 * What is already booked in a market, ahead of today.
 *
 * WHY THIS IS WORTH A CALL. Every other figure this product shows is
 * trailing — it says what a market did. A twelve-month lease is signed
 * against what it is about to do, and the two come apart exactly when
 * it matters most: a rule change, a wave of new supply, a season that
 * is not coming back. A trailing twelve still looks healthy through all
 * three. The calendars that are on sale right now do not.
 *
 * WHAT THIS IS NOT. Forward booked share is NOT last year's occupancy
 * and must never be subtracted from it. "October is 34% booked" is a
 * month still filling, read at whatever lead time today happens to be;
 * "October finished at 71%" is a month that is over. Differencing them
 * produces a decline that is really just the calendar, which is why
 * nothing here computes one — the two series are shown side by side,
 * each labelled for what it is, and the reader draws the line.
 *
 * Kept under its own key in the shared store, so the first account to
 * buy a market's pace buys it for everybody. On a SHORT leash, though:
 * forward bookings move every day, and a stale pace is worse than none
 * because it looks exactly as current as a fresh one.
 */

import { fetchMarketPacing, hasAirRoiKey, type LiveMarketPace } from "@/lib/live/airroi";
import { catalogueRef } from "@/lib/live/market-live";
import { isFresh, readKeyedBlob, writeKeyed } from "@/lib/db/market-store";
import type { Market } from "@/lib/mock/types";

/**
 * How long a bought pace stands: a week.
 *
 * Deliberately far shorter than the month a trailing figure gets. A
 * trailing twelve barely moves in a month; a forward book moves every
 * night somebody reserves. PACING_TTL_HOURS overrides it, capped at a
 * month so it can never be set to something that would hand a reader a
 * season-old "already booked" figure.
 */
export const PACING_TTL_MS = (() => {
  const raw = Number(process.env.PACING_TTL_HOURS);
  const hours = Number.isFinite(raw) && raw > 0 ? Math.min(24 * 30, raw) : 24 * 7;
  return hours * 60 * 60 * 1000;
})();

/** The store key and the credit key for one market's forward book. */
export function pacingKey(marketSlug: string): string {
  return `market-pace:${marketSlug}`;
}

/** Read a stored pace back out of an untyped blob. Tolerant, like the
 *  history reader, and for the same reason: rows written by an earlier
 *  deploy have to survive this one. */
export function readPace(value: unknown): LiveMarketPace[] {
  const rows = Array.isArray(value)
    ? value
    : Array.isArray((value as { days?: unknown } | null)?.days)
      ? (value as { days: unknown[] }).days
      : [];
  const out: LiveMarketPace[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = typeof r.date === "string" ? r.date : null;
    const booked =
      typeof r.booked === "number" && Number.isFinite(r.booked) ? r.booked : null;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || booked === null) continue;
    const num = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    out.push({
      date,
      booked: Math.min(1, Math.max(0, booked)),
      adr: num(r.adr),
      listings: num(r.listings),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** One month of forward book, rolled up from its days. */
export interface PaceMonth {
  /** YYYY-MM-01, matching every other month in this product. */
  month: string;
  /** Mean share of those days already booked, 0–1. */
  booked: number;
  /** Mean rate those bookings are going out at, when the feed said. */
  adr: number | null;
  /** How many dates this month was averaged from — a month read from
   *  three days is not a month, and the view needs to know. */
  days: number;
}

/** Months with fewer dates than this are dropped: too thin to average. */
export const MIN_PACE_DAYS = 5;

/**
 * Roll forward days into months.
 *
 * A plain mean over the days present, NOT weighted by listing count:
 * the counts are optional in the payload and a mean that silently
 * changes meaning depending on whether the feed sent them is worse
 * than one that is always the same simple thing.
 */
export function paceMonths(rows: readonly LiveMarketPace[]): PaceMonth[] {
  const buckets = new Map<string, { booked: number[]; adr: number[] }>();
  for (const row of rows) {
    const month = `${row.date.slice(0, 7)}-01`;
    const b = buckets.get(month) ?? { booked: [], adr: [] };
    b.booked.push(row.booked);
    if (row.adr !== null) b.adr.push(row.adr);
    buckets.set(month, b);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return [...buckets.entries()]
    .filter(([, b]) => b.booked.length >= MIN_PACE_DAYS)
    .map(([month, b]) => ({
      month,
      booked: Math.round(mean(b.booked) * 1000) / 1000,
      adr: b.adr.length > 0 ? Math.round(mean(b.adr)) : null,
      days: b.booked.length,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Last year's finished occupancy for the same calendar months.
 *
 * Returned BESIDE the forward figure, never subtracted from it — see
 * the note at the top of this file. Keyed by month-of-year so a
 * trailing series that ended last autumn still lines up with a forward
 * one that runs into next spring.
 */
export function lastYearByMonth(
  months: readonly { month: string; occupancy: number }[]
): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of months) out.set(m.month.slice(5, 7), m.occupancy);
  return out;
}

export interface StoredPace {
  days: LiveMarketPace[];
  at: string | null;
}

/** This market's forward book if it is on file and still current. */
export async function storedMarketPacing(
  marketSlug: string
): Promise<StoredPace | null> {
  const row = await readKeyedBlob(pacingKey(marketSlug)).catch(() => null);
  if (!row || !isFresh(row.at, PACING_TTL_MS)) return null;
  const days = readPace(row.value);
  return days.length > 0 ? { days, at: row.at } : null;
}

export type BuyPaceResult =
  | { ok: true; days: LiveMarketPace[]; at: string; bought: boolean }
  | { ok: false; reason: "no-key" | "not-found" | "failed" };

/** Buy one market's forward book and keep it. */
export async function buyMarketPacing(market: Market): Promise<BuyPaceResult> {
  if (!hasAirRoiKey()) return { ok: false, reason: "no-key" };
  try {
    const days = await fetchMarketPacing(catalogueRef(market));
    if (days.length === 0) return { ok: false, reason: "not-found" };
    const at = new Date().toISOString();
    // Never let a storage failure cost the answer just paid for.
    await writeKeyed(pacingKey(market.slug), { days }).catch(() => {});
    return { ok: true, days, at, bought: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
