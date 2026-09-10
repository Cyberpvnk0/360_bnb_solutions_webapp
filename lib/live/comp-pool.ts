/**
 * The market's comp pool: every real short-term listing a comp set has
 * ever carried, kept so the Deal Finder can project a card from the
 * listings around it rather than from an average of the whole city —
 * and at no cost, because every listing here was bought for an
 * analysis somebody's plan already paid for.
 *
 * Every comp set bought for the analyzer is a couple of dozen real
 * listings with a rate, an occupancy, a size and a place. A market's
 * sets together are a map of what actually books there, and the map
 * fills in as the platform is used: each analysis anywhere in a city
 * makes every card within two miles of it more exact.
 *
 * A CARD IS PROJECTED THE WAY THE ANALYZER WOULD PROJECT IT. The
 * analyzer stands on a set bought for the property's size within two
 * miles, the one-mile subset when there are enough; its rate and
 * occupancy are the set's means. A card mimics that set out of the
 * pool: the listings of the property's own size first, then those
 * within a bedroom of it with each rate brought to the property's
 * size, then any size the same way; the nearest couple of dozen; the
 * one-mile subset when there are enough. So a card's figures are the
 * closest free reading of what an analysis of it would say — and the
 * analysis, once run, replaces them (lib/live/property-figures).
 *
 * A LISTING WITHOUT COORDINATES STILL HAS A PLACE. The feed blurs, and
 * sometimes withholds, a listing's position; what it always gives is
 * the distance from the point the set was bought around. Such a comp
 * is kept at that point with its distance, and its distance to any
 * card is the sum of the two — an upper bound, so a listing is never
 * counted closer than it can be, and never further than two miles
 * when it is counted at all.
 *
 * A CARD WITH NOTHING NEAR IT STANDS ON THE MARKET'S RATE FOR ITS SIZE.
 * Measured from the pool where the pool holds enough listings of that
 * size anywhere in the market — a market's own four-bedrooms say what
 * a four-bedroom goes for — and scaled from the catalogue's size table
 * otherwise: off the measured sizes when there are any, off the city's
 * average and the typical home when there are none (sizeModel).
 *
 * THE ANALYSES THEMSELVES CORRECT THE REST. A city's average, and the
 * listings students happen to have analyzed, are not quite what a
 * whole home in the parts of town they actually analyze earns. Each
 * analysis leaves an anchor here — its point, its size, the figures it
 * stood on — and the ratio of those figures to what the market's rate
 * for that size would have said, over the market's anchors, corrects
 * every card that falls to it.
 *
 * The pool is a cache of facts about listings, not about people: an id,
 * a place, a rate, an occupancy, a bedroom count, a date. A listing
 * older than three months in the pool is dropped on the next write.
 */

import { COMPS_RADIUS_MAX_MILES, MIN_COMPS, selectNearbyComps } from "@/lib/calc/comps";
import { readKeyedBlob, writeKeyed } from "@/lib/db/market-store";
import { adrFactorFor } from "@/lib/mock/markets";
import type { StrComp } from "@/lib/mock/types";

export interface PoolComp {
  id: string;
  lat: number;
  lon: number;
  bd: number;
  adr: number;
  /** Fraction. */
  occ: number;
  /** When it joined the pool, ISO. */
  at: string;
  /** Set when lat/lon are the point the set was bought around rather
   *  than the listing's own: how far the listing is from that point. */
  dist?: number;
}

/** One analysis's footing: where it was, what size, what it stood on. */
export interface PoolAnchor {
  lat: number;
  lon: number;
  bd: number;
  adr: number;
  /** Fraction. */
  occ: number;
  /** When the analysis was run, ISO. */
  at: string;
}

export interface Pool {
  comps: PoolComp[];
  anchors: PoolAnchor[];
}

const POOL_CAP = 3000;
const COMP_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const ANCHOR_CAP = 400;
const ANCHOR_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
/** How long a read pool is held in memory before the store is asked
 *  again: a page of cards is one read, not twenty-four. */
const MEMORY_MS = 2 * 60 * 1000;
/** A comp set is a couple of dozen listings; a card's mimicked set is
 *  the nearest that many, never the whole pool around it. */
export const SET_SIZE = 25;
/** Anchors before the city's average is corrected by them: a median of
 *  fewer says more about the analyses than about the city. */
export const MIN_ANCHORS = 3;
/**
 * What a city-wide average rate is an average of: the typical whole
 * home, in bedrooms, when the market's own mix is not known. The
 * catalogue's size table is written relative to a two-bedroom, and a
 * city's average is not a two-bedroom's rate — it already holds every
 * three-, four- and five-bedroom home in the city — so a rate scaled
 * from it by the table's row alone counted the size twice.
 */
export const TYPICAL_BEDROOMS = 2.7;
/** Listings of one size in the market's pool before that size's rate
 *  is measured from them rather than scaled from the table. */
export const MIN_SIZE_SAMPLE = 8;
/** The most bedrooms a card's rate is spelled out for; beyond it the
 *  table holds, as it does everywhere. */
const RATES_UP_TO = 8;
/** The correction is a nudge, never a rewrite. */
const CALIBRATION_FLOOR = 0.5;
const CALIBRATION_CEILING = 2;

function poolKey(marketSlug: string): string {
  return `comp-pool:v1:${marketSlug}`;
}

export function isPoolComp(value: unknown): value is PoolComp {
  const c = value as PoolComp | null;
  return (
    !!c &&
    typeof c === "object" &&
    typeof c.id === "string" &&
    typeof c.lat === "number" &&
    typeof c.lon === "number" &&
    typeof c.bd === "number" &&
    typeof c.adr === "number" &&
    typeof c.occ === "number" &&
    typeof c.at === "string" &&
    (c.dist === undefined || typeof c.dist === "number")
  );
}

export function isPoolAnchor(value: unknown): value is PoolAnchor {
  const a = value as PoolAnchor | null;
  return (
    !!a &&
    typeof a === "object" &&
    typeof a.lat === "number" &&
    typeof a.lon === "number" &&
    typeof a.bd === "number" &&
    typeof a.adr === "number" &&
    a.adr > 0 &&
    typeof a.occ === "number" &&
    a.occ >= 0 &&
    a.occ <= 1 &&
    typeof a.at === "string"
  );
}

const memory = new Map<string, { at: number; pool: Pool }>();

export async function readPool(marketSlug: string): Promise<Pool> {
  const held = memory.get(marketSlug);
  if (held && Date.now() - held.at < MEMORY_MS) return held.pool;
  const stored = await readKeyedBlob(poolKey(marketSlug)).catch(() => null);
  const raw = stored?.value as { comps?: unknown; anchors?: unknown } | undefined;
  const pool: Pool = {
    comps: Array.isArray(raw?.comps) ? raw.comps.filter(isPoolComp) : [],
    anchors: Array.isArray(raw?.anchors) ? raw.anchors.filter(isPoolAnchor) : [],
  };
  memory.set(marketSlug, { at: Date.now(), pool });
  return pool;
}

/**
 * The pool's shape of a comp set bought around `subject`: a listing's
 * own place when the feed gave one, the subject's place and the
 * listing's distance from it when it did not.
 */
export function toPoolComps(
  comps: readonly StrComp[],
  subject: { lat: number; lon: number },
  at = new Date().toISOString()
): PoolComp[] {
  const out: PoolComp[] = [];
  for (const c of comps) {
    if (c.active === false) continue;
    if (!Number.isFinite(c.adr) || c.adr <= 0) continue;
    if (!(c.occupancy >= 0 && c.occupancy <= 1)) continue;
    const base = {
      id: String(c.id),
      bd: Math.max(0, Math.round(c.bedrooms)),
      adr: Math.round(c.adr),
      occ: Math.round(c.occupancy * 1000) / 1000,
      at,
    };
    if (typeof c.lat === "number" && typeof c.lon === "number") {
      out.push({ ...base, lat: c.lat, lon: c.lon });
    } else if (Number.isFinite(c.distanceMiles) && c.distanceMiles >= 0) {
      out.push({
        ...base,
        lat: subject.lat,
        lon: subject.lon,
        dist: Math.round(c.distanceMiles * 100) / 100,
      });
    }
  }
  return out;
}

/** The pool after a set joins it: newest wins on an id, the old are
 *  dropped, and the cap holds. */
export function mergePool(
  existing: readonly PoolComp[],
  incoming: readonly PoolComp[],
  now = Date.now()
): PoolComp[] {
  const byId = new Map<string, PoolComp>();
  for (const c of existing) {
    const age = now - Date.parse(c.at);
    if (Number.isFinite(age) && age < COMP_MAX_AGE_MS) byId.set(c.id, c);
  }
  for (const c of incoming) byId.set(c.id, c);
  return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, POOL_CAP);
}

/** One anchor per point and size: a property analyzed twice is one
 *  footing, the newer one. */
function anchorId(a: { lat: number; lon: number; bd: number }): string {
  return `${a.lat.toFixed(3)},${a.lon.toFixed(3)}:${a.bd}`;
}

/** The anchors after an analysis joins them: newest wins on a point
 *  and size, the old are dropped, and the cap holds. */
export function mergeAnchors(
  existing: readonly PoolAnchor[],
  incoming: readonly PoolAnchor[],
  now = Date.now()
): PoolAnchor[] {
  const byId = new Map<string, PoolAnchor>();
  for (const a of existing) {
    const age = now - Date.parse(a.at);
    if (Number.isFinite(age) && age < ANCHOR_MAX_AGE_MS) byId.set(anchorId(a), a);
  }
  for (const a of incoming) byId.set(anchorId(a), a);
  return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, ANCHOR_CAP);
}

/**
 * A comp set, and the analysis that stood on it, join the market's
 * pool. The anchor is what the analysis projected from — its size and
 * the figures its comps gave — and is left out when the set was too
 * thin to project from.
 */
export async function addToPool(
  marketSlug: string,
  comps: readonly StrComp[],
  subject: { lat: number; lon: number },
  anchor: { bd: number; adr: number; occ: number } | null = null
): Promise<void> {
  const at = new Date().toISOString();
  const incoming = toPoolComps(comps, subject, at);
  const footing: PoolAnchor[] =
    anchor && anchor.adr > 0 && anchor.occ >= 0 && anchor.occ <= 1
      ? [{ lat: subject.lat, lon: subject.lon, bd: Math.round(anchor.bd), adr: Math.round(anchor.adr), occ: Math.round(anchor.occ * 1000) / 1000, at }]
      : [];
  if (incoming.length === 0 && footing.length === 0) return;
  const existing = await readPool(marketSlug);
  const pool: Pool = {
    comps: mergePool(existing.comps, incoming),
    anchors: mergeAnchors(existing.anchors, footing),
  };
  memory.set(marketSlug, { at: Date.now(), pool });
  await writeKeyed(poolKey(marketSlug), pool).catch(() => undefined);
}

const EARTH_RADIUS_MILES = 3958.8;
export function milesBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

/** How far a pool comp is from a point: its own distance, or — for a
 *  comp kept at the point its set was bought around — no more than
 *  that distance plus its own from there. */
export function poolDistance(comp: PoolComp, point: { lat: number; lon: number }): number {
  return milesBetween(point, comp) + (comp.dist ?? 0);
}

/** The catalogue's size factor at a fractional size: read between the
 *  rows, so a typical size of 2.7 sits between the two- and three-
 *  bedroom rows rather than on one of them. */
export function tableFactor(bedrooms: number): number {
  const lo = Math.floor(bedrooms);
  const hi = Math.ceil(bedrooms);
  if (lo === hi) return adrFactorFor(lo);
  const t = bedrooms - lo;
  return adrFactorFor(lo) * (1 - t) + adrFactorFor(hi) * t;
}

/**
 * The market's nightly rate by size.
 *
 * Measured where the pool holds enough listings of a size: the median
 * rate of a market's own four-bedrooms is the four-bedroom rate, not
 * a table's guess at it. Sizes the pool has too few of are scaled by
 * the catalogue's table — from the measured sizes when there are any,
 * so a market's two- and four-bedroom rates never disagree about what
 * the market costs; from the city's average scaled off the typical
 * home when nothing is measured yet.
 */
export interface SizeModel {
  /** The rate for a size, in dollars; 0 when nothing here can say. */
  rate: (bedrooms: number) => number;
  /** What multiplies one size's rate into another's. */
  ratio: (from: number, to: number) => number;
  /** The sizes measured from the pool. */
  measured: Record<number, { adr: number; comps: number }>;
  /** Dollars per table unit: a two-bedroom's rate on this market's scale. */
  level: number | null;
}

export function sizeModel(
  comps: readonly PoolComp[],
  city: { adr: number } | null
): SizeModel {
  const bySize = new Map<number, number[]>();
  for (const c of comps) {
    if (!(c.adr > 0)) continue;
    const bd = Math.max(0, Math.round(c.bd));
    const list = bySize.get(bd);
    if (list) list.push(c.adr);
    else bySize.set(bd, [c.adr]);
  }
  const measured: SizeModel["measured"] = {};
  for (const [bd, adrs] of bySize) {
    if (adrs.length >= MIN_SIZE_SAMPLE) {
      measured[bd] = { adr: Math.round(median(adrs)), comps: adrs.length };
    }
  }
  const levels = Object.entries(measured).map(([bd, m]) => m.adr / adrFactorFor(Number(bd)));
  const level =
    levels.length > 0
      ? median(levels)
      : city && city.adr > 0
        ? city.adr / tableFactor(TYPICAL_BEDROOMS)
        : null;
  const rate = (bedrooms: number): number => {
    const bd = Math.max(0, Math.round(bedrooms));
    const m = measured[bd];
    if (m) return m.adr;
    return level === null ? 0 : level * adrFactorFor(bd);
  };
  const ratio = (from: number, to: number): number => {
    const a = rate(from);
    const b = rate(to);
    return a > 0 && b > 0 ? b / a : adrFactorFor(to) / adrFactorFor(from);
  };
  return { rate, ratio, measured, level };
}

/**
 * How the listings a reading stands on relate to the property's size.
 *
 *   exact   its own bedroom count, rates taken as they are.
 *   close   within a bedroom of it, each rate brought to its size.
 *   scaled  any size within reach, each rate brought to its size.
 */
export type Sizing = "exact" | "close" | "scaled";

export interface NearbyFigures {
  /** This size's nightly rate: the set's mean. */
  adr: number;
  /** Fraction: the set's mean. */
  occupancy: number;
  comps: number;
  radiusMiles: number;
  sizing: Sizing;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * What the listings around a point say for a property of this size —
 * the set the analyzer would buy for it, mimicked out of the pool —
 * or null when too few are within two miles to say anything.
 */
export function nearbyFigures(
  pool: readonly PoolComp[],
  point: { lat: number; lon: number },
  bedrooms: number,
  model: SizeModel = sizeModel(pool, null)
): NearbyFigures | null {
  const placed = pool
    .map((c) => ({ ...c, distanceMiles: poolDistance(c, point) }))
    .filter((c) => c.distanceMiles <= COMPS_RADIUS_MAX_MILES)
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
  const tiers: { sizing: Sizing; fits: (c: PoolComp) => boolean }[] = [
    { sizing: "exact", fits: (c) => c.bd === bedrooms },
    { sizing: "close", fits: (c) => Math.abs(c.bd - bedrooms) <= 1 },
    { sizing: "scaled", fits: () => true },
  ];
  for (const tier of tiers) {
    const set = placed.filter(tier.fits).slice(0, SET_SIZE);
    if (set.length < MIN_COMPS) continue;
    const { comps, radiusMiles } = selectNearbyComps(set);
    const rate = (c: PoolComp) => (tier.sizing === "exact" ? c.adr : c.adr * model.ratio(c.bd, bedrooms));
    return {
      adr: Math.round(mean(comps.map(rate))),
      occupancy: Math.round(mean(comps.map((c) => c.occ)) * 100) / 100,
      comps: comps.length,
      radiusMiles,
      sizing: tier.sizing,
    };
  }
  return null;
}

/** A read of the pool around a point, for a diagnostic: how many
 *  listings sit within a mile and within two, and the nearest few. */
export function poolAround(
  pool: readonly PoolComp[],
  point: { lat: number; lon: number }
): { size: number; within1: number; within2: number; nearest: number[] } {
  const d = pool.map((c) => poolDistance(c, point)).sort((a, b) => a - b);
  return {
    size: pool.length,
    within1: d.filter((x) => x <= 1).length,
    within2: d.filter((x) => x <= COMPS_RADIUS_MAX_MILES).length,
    nearest: d.slice(0, 5).map((x) => Math.round(x * 100) / 100),
  };
}

/** How the market's analyses compare with its city-wide average. */
export interface Calibration {
  /** Analyses the correction stands on. */
  n: number;
  /** Multiply the city's rate, scaled to a size, by this. */
  adr: number;
  /** Multiply the city's occupancy by this. */
  occupancy: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const clamp = (x: number) =>
  Math.min(CALIBRATION_CEILING, Math.max(CALIBRATION_FLOOR, x));

/**
 * The correction the market's analyses put on what a card with nothing
 * near it would say: the median, over the anchors, of what an analysis
 * stood on against the market's rate for its size, and of its
 * occupancy against the city's. Null until enough analyses have been
 * run here to say anything.
 */
export function cityCalibration(
  anchors: readonly PoolAnchor[],
  city: { adr: number; occupancy: number } | null,
  model: SizeModel
): Calibration | null {
  if (!city || !(city.adr > 0) || !(city.occupancy > 0)) return null;
  const usable = anchors.filter((a) => a.adr > 0 && a.occ > 0 && model.rate(a.bd) > 0);
  if (usable.length < MIN_ANCHORS) return null;
  const adr = clamp(median(usable.map((a) => a.adr / model.rate(a.bd))));
  const occupancy = clamp(median(usable.map((a) => a.occ / city.occupancy)));
  return {
    n: usable.length,
    adr: Math.round(adr * 1000) / 1000,
    occupancy: Math.round(occupancy * 1000) / 1000,
  };
}

/**
 * The city's figures as a card uses them: the market's rate for every
 * size, and the city's average and occupancy, with the analyses'
 * correction on all of them.
 */
export function calibrate<T extends { adr: number; occupancy: number }>(
  city: T,
  calibration: Calibration | null,
  model: SizeModel
): T & { calibration: Calibration | null; rates: Record<number, number> } {
  const k = calibration?.adr ?? 1;
  const rates: Record<number, number> = {};
  for (let bd = 0; bd <= RATES_UP_TO; bd += 1) {
    const rate = model.rate(bd);
    if (rate > 0) rates[bd] = Math.round(rate * k);
  }
  if (!calibration) return { ...city, calibration: null, rates };
  return {
    ...city,
    adr: Math.round(city.adr * calibration.adr),
    occupancy: Math.min(1, Math.round(city.occupancy * calibration.occupancy * 100) / 100),
    calibration,
    rates,
  };
}

/** Tests only. */
export function resetCompPoolMemory(): void {
  memory.clear();
}
