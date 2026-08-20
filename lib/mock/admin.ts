/**
 * Internal admin metrics for a ~3,500-student cohort.
 * MRR and revenue share are computed from tier counts and the live tier
 * prices in config/app — change a price there and this dashboard follows.
 */

import { TIERS, type TierId } from "@/config/app";
import { Rng, daysAgo, trailingMonths } from "./seed";
import type { AdminMetrics, AdminUserRow } from "./types";

/** Paying-tier distribution across the cohort. */
const TIER_COUNTS: { tier: TierId; count: number }[] = [
  { tier: "free", count: 2210 },
  { tier: "starter", count: 640 },
  { tier: "pro", count: 495 },
  { tier: "scale", count: 155 },
];

const PAYING = TIER_COUNTS.filter((t) => t.tier !== "free");

/** Blended MRR: annual subscribers contribute priceAnnual / 12.
 *  Modeled annual mix: 40% of paying accounts. */
const ANNUAL_MIX = 0.4;

function tierMrr(tier: TierId, count: number): number {
  const t = TIERS[tier];
  const monthlyPart = count * (1 - ANNUAL_MIX) * t.priceMonthly;
  const annualPart = count * ANNUAL_MIX * (t.priceAnnual / 12);
  return monthlyPart + annualPart;
}

const MRR = Math.round(
  PAYING.reduce((sum, { tier, count }) => sum + tierMrr(tier, count), 0)
);

const FIRST = ["Casey", "Morgan", "Riley", "Devon", "Skyler", "Quinn", "Reese", "Avery", "Jamie", "Rowan", "Harper", "Emerson", "Finley", "Dakota", "Sage", "Peyton"];
const LAST = ["Trent", "Marsh", "Bowden", "Calloway", "Reyes", "Fontaine", "Ellery", "Sutton", "Vargas", "Kimball", "Ostrander", "Pike", "Renner", "Shue", "Tobin", "Ulrich"];

const rng = new Rng(0xad31);

const USERS: AdminUserRow[] = Array.from({ length: 16 }, (_, i) => {
  const tier = rng.pick<TierId>(["free", "free", "starter", "starter", "pro", "pro", "pro", "scale"]);
  const limit = TIERS[tier].pullLimit;
  return {
    id: `au-${String(i + 1).padStart(2, "0")}`,
    name: `${FIRST[i]} ${LAST[i]}`,
    email: `${FIRST[i].toLowerCase()}.${LAST[i].toLowerCase()}@example.com`,
    tier,
    pullsUsed: limit === 0 ? 0 : rng.int(0, limit),
    joinedAt: daysAgo(rng.int(5, 400)),
  };
});

/** Pull volume ramps with the cohort over the trailing year. */
const PULL_VOLUME = trailingMonths(12).map((month, i) => ({
  month,
  pulls: Math.round((14000 + i * 2600) * rng.float(0.92, 1.08)),
}));

export const ADMIN: AdminMetrics = {
  mrr: MRR,
  activeSubscriptions: PAYING.reduce((s, t) => s + t.count, 0),
  freeAccounts: TIER_COUNTS[0].count,
  tierCounts: TIER_COUNTS,
  pullVolume: PULL_VOLUME,
  dataCostPerUser: 4.85,
  revShareRate: 0.3,
  users: USERS,
};
