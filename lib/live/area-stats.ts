/**
 * A ZIP's real figures, bought once and shared by everyone after.
 *
 * The market page can rank its ZIPs for nothing off the listings the
 * product has already seen, and that ranking is a sample: it says
 * which parts of a city the analyses have found rates in, not how many
 * listings are really there. The one thing a sample can never give is
 * a count of the supply, which is exactly what somebody choosing a
 * neighbourhood wants.
 *
 * So a ZIP can be bought. The short-let feed answers at ZIP scope
 * natively — a coordinate resolves to a district and the summary for
 * that district is the whole ZIP, not the part we happened to see — and
 * the answer lands in the shared store like a market's does. Two billed
 * calls the first time: one to turn the point into the feed's own ZIP,
 * one for the figures. A ZIP somebody already bought costs nothing for
 * everyone else, for as long as the figures stay fresh.
 */

import {
  fetchMarketIdentity,
  fetchMarketSummary,
  hasAirRoiKey,
} from "@/lib/live/airroi";
import { checkLiveSearch, commitLiveSearch } from "@/lib/live/quota";
import {
  isFresh,
  readKeyedBlobs,
  STATS_TTL_MS,
  writeKeyed,
} from "@/lib/db/market-store";
import type { MeasuredArea } from "@/lib/markets/areas";

/** Where one ZIP's figures live. Namespaced by market, because the
 *  same ZIP can sit at the edge of two of our markets and each one
 *  asked about it from its own point. */
export function areaKey(marketSlug: string, zip: string): string {
  return `area:${marketSlug}:${zip}`;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Stored rows are tolerated, never trusted: a row written by an older
 *  shape must read as a partial answer rather than break the table. */
function fromStored(value: Record<string, unknown>, at: string | null): MeasuredArea {
  return {
    adr: num(value.adr),
    occupancy: num(value.occupancy),
    revenue: num(value.revenue),
    revpar: num(value.revpar),
    activeListings: num(value.activeListings),
    fullName: str(value.fullName),
    at,
  };
}

/** Every bought ZIP this market has, in one round trip. */
export async function readAreaStats(
  marketSlug: string,
  zips: readonly string[]
): Promise<Map<string, MeasuredArea>> {
  const out = new Map<string, MeasuredArea>();
  const wanted = [...new Set(zips)].filter((z) => /^\d{5}$/.test(z));
  if (wanted.length === 0) return out;
  const rows = await readKeyedBlobs(wanted.map((z) => areaKey(marketSlug, z))).catch(
    () => new Map<string, { value: Record<string, unknown>; at: string | null }>()
  );
  for (const zip of wanted) {
    const hit = rows.get(areaKey(marketSlug, zip));
    if (hit) out.set(zip, fromStored(hit.value, hit.at));
  }
  return out;
}

export type BuyAreaResult =
  | { ok: true; zip: string; stats: MeasuredArea; bought: boolean }
  | { ok: false; reason: "no-key" | "quota" | "not-found" | "failed" };

/**
 * One ZIP's figures: stored if fresh, bought if not.
 *
 * `zip` is what our own rentals say the area is; the feed resolves the
 * point to its own district and that is what gets stored, under the ZIP
 * we asked about. They agree in every case seen so far, and where they
 * would not, the row a reader asked for is the row they get back.
 */
export async function areaStats(
  marketSlug: string,
  zip: string,
  point: { lat: number; lon: number }
): Promise<BuyAreaResult> {
  const key = areaKey(marketSlug, zip);
  const stored = (await readKeyedBlobs([key]).catch(() => null))?.get(key);
  if (stored && isFresh(stored.at, STATS_TTL_MS)) {
    return { ok: true, zip, stats: fromStored(stored.value, stored.at), bought: false };
  }
  if (!hasAirRoiKey()) return { ok: false, reason: "no-key" };
  // The same daily ledger a market search spends from: a ZIP is an
  // area, and the cap is on distinct areas rather than on which screen
  // asked about one.
  if (!checkLiveSearch(key).allowed) return { ok: false, reason: "quota" };

  try {
    const found = await fetchMarketIdentity(point);
    if (!found.market) return { ok: false, reason: "not-found" };
    const summary = await fetchMarketSummary(found.market);
    const s = summary?.summary;
    // Rates are what the row is for; a response carrying neither is
    // not worth storing and would read as a measured zero.
    if (!s || (s.adr === null && s.occupancy === null && s.activeListings === null)) {
      return { ok: false, reason: "not-found" };
    }
    const stats: MeasuredArea = {
      adr: s.adr,
      occupancy: s.occupancy,
      revenue: s.revenue,
      revpar: s.revpar,
      activeListings: s.activeListings,
      fullName: found.fullName ?? summary?.fullName ?? null,
      at: new Date().toISOString(),
    };
    commitLiveSearch(key);
    // Never let a storage failure cost the answer just paid for.
    await writeKeyed(key, {
      adr: stats.adr,
      occupancy: stats.occupancy,
      revenue: stats.revenue,
      revpar: stats.revpar,
      activeListings: stats.activeListings,
      fullName: stats.fullName,
      district: found.market.district ?? null,
    }).catch(() => {});
    return { ok: true, zip, stats, bought: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
