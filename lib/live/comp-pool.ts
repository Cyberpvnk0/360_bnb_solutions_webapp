/**
 * The market's comp pool: every real short-term listing a comp set has
 * ever carried, kept so the Deal Finder can project a card from the
 * listings around it rather than from an average of the whole city.
 *
 * Every comp set bought for the analyzer is a couple of dozen real
 * listings with a rate, an occupancy, a size and a place. A market's
 * sets together are a map of what actually books there. A card for a
 * property is projected from the listings within a mile of it when
 * there are enough, within two when there are not, and from nothing
 * here otherwise — never from listings further off than that.
 *
 * A LISTING WITHOUT COORDINATES STILL HAS A PLACE. The feed blurs, and
 * sometimes withholds, a listing's position; what it always gives is
 * the distance from the point the set was bought around. Such a comp
 * is kept at that point with its distance, and its distance to any
 * card is the sum of the two — an upper bound, so a listing is never
 * counted closer than it can be, and never further than two miles
 * when it is counted at all.
 *
 * SEEDED, SO A MARKET NOBODY HAS ANALYZED STILL HAS A POOL. The first
 * time a card sits in a patch of the map (a cell about a mile and a
 * half across) with no listings near it, one comp set is bought at
 * that card's point and size — the same purchase the analyzer would
 * make, under the same key, so that card's own figures are exact from
 * then on and a later analysis of it is free. One set a month per
 * cell, at eighteen cents; ZIP_FIGURES_DAILY_CAP is the brake.
 *
 * The pool is a cache of facts about listings, not about people: an id,
 * a place, a rate, an occupancy, a bedroom count, a date. A listing
 * older than six weeks in the pool is dropped on the next write.
 */

import { COMPS_RADIUS_MAX_MILES, MIN_COMPS, selectNearbyComps } from "@/lib/calc/comps";
import {
  estimateKey,
  isFresh,
  readEstimate,
  readKeyedBlob,
  writeEstimate,
  writeKeyed,
} from "@/lib/db/market-store";
import { adrFactorFor } from "@/lib/mock/markets";
import type { Market, StrComp } from "@/lib/mock/types";
import { fetchEstimate, hasAirRoiKey } from "./airroi";
import { checkLiveSearch, commitLiveSearch } from "./quota";
import { compsSpecFor, ESTIMATE_TTL_MS, ESTIMATE_VERSION } from "./str-comps";

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

const POOL_CAP = 3000;
const COMP_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;
/** How long a read pool is held in memory before the store is asked
 *  again: a page of cards is one read, not twenty-four. */
const MEMORY_MS = 2 * 60 * 1000;
/** A seed stands for its cell for a month. */
const SEED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Cells about a mile and a half across: a set bought within two miles
 *  of a cell's card reaches every other card in it. */
const CELL_DEGREES = 0.02;

const SEED_DAILY_CAP = (() => {
  const raw = Number(process.env.ZIP_FIGURES_DAILY_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : Number.POSITIVE_INFINITY;
})();

function poolKey(marketSlug: string): string {
  return `comp-pool:v1:${marketSlug}`;
}

/** The patch of map a point falls in. */
export function seedCell(point: { lat: number; lon: number }): string {
  return `${Math.round(point.lat / CELL_DEGREES)}:${Math.round(point.lon / CELL_DEGREES)}`;
}
function seedKey(cell: string): string {
  return `seed:v2:${cell}`;
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

const memory = new Map<string, { at: number; comps: PoolComp[] }>();

export async function readPool(marketSlug: string): Promise<PoolComp[]> {
  const held = memory.get(marketSlug);
  if (held && Date.now() - held.at < MEMORY_MS) return held.comps;
  const stored = await readKeyedBlob(poolKey(marketSlug)).catch(() => null);
  const raw = (stored?.value as { comps?: unknown } | undefined)?.comps;
  const comps = Array.isArray(raw) ? raw.filter(isPoolComp) : [];
  memory.set(marketSlug, { at: Date.now(), comps });
  return comps;
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

export async function addToPool(
  marketSlug: string,
  comps: readonly StrComp[],
  subject: { lat: number; lon: number }
): Promise<void> {
  const incoming = toPoolComps(comps, subject);
  if (incoming.length === 0) return;
  const existing = await readPool(marketSlug);
  const merged = mergePool(existing, incoming);
  memory.set(marketSlug, { at: Date.now(), comps: merged });
  await writeKeyed(poolKey(marketSlug), { comps: merged }).catch(() => undefined);
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

export interface NearbyFigures {
  /** This size's nightly rate, from listings of about this size when
   *  there are enough, else the pool's rate scaled to this size. */
  adr: number;
  /** Fraction. */
  occupancy: number;
  comps: number;
  radiusMiles: number;
}

/**
 * What the listings around a point say, or null when too few are
 * within two miles to say anything.
 */
export function nearbyFigures(
  pool: readonly PoolComp[],
  point: { lat: number; lon: number },
  bedrooms: number
): NearbyFigures | null {
  const placed = pool.map((c) => ({ ...c, distanceMiles: poolDistance(c, point) }));
  const { comps, radiusMiles } = selectNearbyComps(placed);
  if (comps.length < MIN_COMPS) return null;
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const alike = comps.filter((c) => Math.abs(c.bd - bedrooms) <= 1);
  let adr: number;
  if (alike.length >= 3) {
    adr = Math.round(mean(alike.map((c) => c.adr)));
  } else {
    // Scale the pool's rate from its typical size to this one.
    const typical = Math.round(mean(comps.map((c) => c.bd)));
    adr = Math.round(mean(comps.map((c) => c.adr)) * (adrFactorFor(bedrooms) / adrFactorFor(typical)));
  }
  const occupancy = Math.round(mean(comps.map((c) => c.occ)) * 100) / 100;
  return { adr, occupancy, comps: comps.length, radiusMiles };
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

let seedDay = "";
let seedCalls = 0;
function seedSlot(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== seedDay) {
    seedDay = today;
    seedCalls = 0;
  }
  if (seedCalls >= SEED_DAILY_CAP) return false;
  seedCalls += 1;
  return true;
}

const seeding = new Map<string, Promise<SeedResult>>();
export type SeedOutcome = "seeded" | "kept" | "skipped" | "failed";
export interface SeedResult {
  outcome: SeedOutcome;
  /** For the person reading a diagnostic: what happened, in words. */
  detail: string;
}

/**
 * Make sure the patch of map around a point has a comp set in the
 * pool: one bought at the given card's point and size, the analyzer's
 * own purchase under the analyzer's own key, once a month per cell.
 * "kept" means the cell already had one, or the set was already on
 * file.
 */
export async function ensureSeed(
  market: Market,
  point: { lat: number; lon: number },
  size: { bedrooms: number; bathrooms: number }
): Promise<SeedResult> {
  const cell = seedCell(point);
  const running = seeding.get(cell);
  if (running) return running;
  const job = (async (): Promise<SeedResult> => {
    const seed = await readKeyedBlob(seedKey(cell)).catch(() => null);
    if (seed && isFresh(seed.at, SEED_TTL_MS)) {
      return { outcome: "kept", detail: `cell ${cell} was seeded ${seed.at ?? "earlier"}` };
    }

    const spec = compsSpecFor(size, point);
    const key = estimateKey(spec);
    const existing = await readEstimate(key).catch(() => null);
    if (existing && isFresh(existing.at, ESTIMATE_TTL_MS) && existing.estimate.v === ESTIMATE_VERSION) {
      await addToPool(market.slug, existing.estimate.comps as StrComp[], point);
      void writeKeyed(seedKey(cell), { key }).catch(() => undefined);
      return { outcome: "kept", detail: `the set at ${key} was already on file and joined the pool` };
    }

    if (!hasAirRoiKey()) return { outcome: "skipped", detail: "no AIRROI_API_KEY" };
    if (!seedSlot()) return { outcome: "skipped", detail: "ZIP_FIGURES_DAILY_CAP reached" };
    const ledger = `seed:${cell}`;
    if (!checkLiveSearch(ledger).allowed) {
      return { outcome: "skipped", detail: "the daily live-search ledger refused" };
    }
    try {
      const estimate = await fetchEstimate({ ...spec, radiusMiles: COMPS_RADIUS_MAX_MILES });
      commitLiveSearch(ledger);
      await writeEstimate(key, {
        v: ESTIMATE_VERSION,
        comps: estimate.comps,
        monthlyRevenue: estimate.monthlyRevenue,
        revenue: estimate.revenue,
        adr: estimate.adr,
        occupancy: estimate.occupancy,
      }).catch(() => ({ ok: false, detail: "write threw" }));
      await addToPool(market.slug, estimate.comps, point);
      void writeKeyed(seedKey(cell), { key }).catch(() => undefined);
      const placed = estimate.comps.filter((c) => typeof c.lat === "number").length;
      return {
        outcome: "seeded",
        detail: `bought ${estimate.comps.length} comps at ${key} (${placed} with coordinates)`,
      };
    } catch (e) {
      return { outcome: "failed", detail: e instanceof Error ? e.message : "purchase failed" };
    }
  })().finally(() => seeding.delete(cell));
  seeding.set(cell, job);
  return job;
}

/** Tests only. */
export function resetCompPoolMemory(): void {
  memory.clear();
  seeding.clear();
  seedDay = "";
  seedCalls = 0;
}
