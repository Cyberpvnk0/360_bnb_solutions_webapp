/**
 * The market's comp pool: every real short-term listing a comp set has
 * ever carried, kept so the Deal Finder can project a card from the
 * listings around it rather than from an average of the whole ZIP.
 *
 * Every comp set bought for the analyzer is twenty-five real listings
 * with a position, a rate, an occupancy and a size. A market's sets
 * together are a map of what actually books there. A card for a
 * property is projected from the listings within a mile of it when
 * there are enough, within two when there are not, and from nothing
 * here otherwise — never from listings further off than that.
 *
 * SEEDED, SO A MARKET NOBODY HAS ANALYZED STILL HAS A POOL. The first
 * time a ZIP has a card on screen, one comp set is bought at that
 * card's point and size — the same purchase the analyzer would make,
 * under the same key, so a later analysis of that property is free —
 * and its listings join the pool. One set a month per ZIP, at eighteen
 * cents, and ZIP_FIGURES_DAILY_CAP is the brake.
 *
 * The pool is a cache of facts about listings, not about people: an id,
 * a position, a rate, an occupancy, a bedroom count, a date. A listing
 * older than six weeks in the pool is dropped on the next write.
 */

import { COMPS_RADIUS_MAX_MILES, MIN_COMPS, selectNearbyComps } from "@/lib/calc/comps";
import { estimateKey, isFresh, readEstimate, readKeyedBlob, writeEstimate, writeKeyed } from "@/lib/db/market-store";
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
}

const POOL_CAP = 3000;
const COMP_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;
/** How long a read pool is held in memory before the store is asked
 *  again: a page of cards is one read, not twenty-four. */
const MEMORY_MS = 2 * 60 * 1000;
/** A seed stands for its ZIP for a month. */
const SEED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SEED_DAILY_CAP = (() => {
  const raw = Number(process.env.ZIP_FIGURES_DAILY_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : Number.POSITIVE_INFINITY;
})();

function poolKey(marketSlug: string): string {
  return `comp-pool:v1:${marketSlug}`;
}
function seedKey(zip: string): string {
  return `zip-seed:v1:${zip}`;
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
    typeof c.at === "string"
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

/** The pool's shape of a comp set: real listings with a position. */
export function toPoolComps(comps: readonly StrComp[], at = new Date().toISOString()): PoolComp[] {
  return comps
    .filter(
      (c) =>
        c.active !== false &&
        typeof c.lat === "number" &&
        typeof c.lon === "number" &&
        Number.isFinite(c.adr) &&
        c.adr > 0 &&
        c.occupancy >= 0 &&
        c.occupancy <= 1
    )
    .map((c) => ({
      id: String(c.id),
      lat: c.lat as number,
      lon: c.lon as number,
      bd: Math.max(0, Math.round(c.bedrooms)),
      adr: Math.round(c.adr),
      occ: Math.round(c.occupancy * 1000) / 1000,
      at,
    }));
}

/** The pool after a set joins it: newest wins on an id, the old are
 *  dropped, and the cap holds. */
export function mergePool(existing: readonly PoolComp[], incoming: readonly PoolComp[], now = Date.now()): PoolComp[] {
  const byId = new Map<string, PoolComp>();
  for (const c of existing) {
    const age = now - Date.parse(c.at);
    if (Number.isFinite(age) && age < COMP_MAX_AGE_MS) byId.set(c.id, c);
  }
  for (const c of incoming) byId.set(c.id, c);
  return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, POOL_CAP);
}

export async function addToPool(marketSlug: string, comps: readonly StrComp[]): Promise<void> {
  const incoming = toPoolComps(comps);
  if (incoming.length === 0) return;
  const existing = await readPool(marketSlug);
  const merged = mergePool(existing, incoming);
  memory.set(marketSlug, { at: Date.now(), comps: merged });
  await writeKeyed(poolKey(marketSlug), { comps: merged }).catch(() => undefined);
}

const EARTH_RADIUS_MILES = 3958.8;
export function milesBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
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
  const placed = pool.map((c) => ({ ...c, distanceMiles: milesBetween(point, c) }));
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

const seeding = new Map<string, Promise<SeedOutcome>>();
export type SeedOutcome = "seeded" | "kept" | "skipped" | "failed";

/**
 * Make sure a ZIP has a comp set in the pool: one bought at the given
 * card's point and size, the analyzer's own purchase under the
 * analyzer's own key, once a month. "kept" means the ZIP already had
 * one, or the set was already on file.
 */
export async function ensureSeed(
  market: Market,
  zip: string,
  point: { lat: number; lon: number },
  size: { bedrooms: number; bathrooms: number }
): Promise<SeedOutcome> {
  if (!/^\d{5}$/.test(zip)) return "skipped";
  const running = seeding.get(zip);
  if (running) return running;
  const job = (async (): Promise<SeedOutcome> => {
    const seed = await readKeyedBlob(seedKey(zip)).catch(() => null);
    if (seed && isFresh(seed.at, SEED_TTL_MS)) return "kept";

    const spec = compsSpecFor(size, point);
    const key = estimateKey(spec);
    const existing = await readEstimate(key).catch(() => null);
    if (existing && isFresh(existing.at, ESTIMATE_TTL_MS) && existing.estimate.v === ESTIMATE_VERSION) {
      await addToPool(market.slug, existing.estimate.comps as StrComp[]);
      void writeKeyed(seedKey(zip), { key }).catch(() => undefined);
      return "kept";
    }

    if (!hasAirRoiKey() || !seedSlot()) return "skipped";
    const ledger = `seed:${zip}`;
    if (!checkLiveSearch(ledger).allowed) return "skipped";
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
      await addToPool(market.slug, estimate.comps);
      void writeKeyed(seedKey(zip), { key }).catch(() => undefined);
      return "seeded";
    } catch {
      return "failed";
    }
  })().finally(() => seeding.delete(zip));
  seeding.set(zip, job);
  return job;
}

/** Tests only. */
export function resetCompPoolMemory(): void {
  memory.clear();
  seeding.clear();
  seedDay = "";
  seedCalls = 0;
}
