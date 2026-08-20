/**
 * 25 saved deals across the five pipeline stages.
 *
 * Each deal links to an analysis; its breakeven occupancy and cash flow are
 * computed from that analysis's comps + default inputs through lib/calc, so
 * the pipeline card always agrees with the analysis screen.
 */

import { breakevenOccupancy, netCashFlow } from "@/lib/calc/arbitrage";
import { deriveMarketAssumptions } from "@/lib/calc/comps";
import { ANALYSES } from "./analyses";
import { daysAgo, Rng } from "./seed";
import type { Deal, PipelineStage } from "./types";

const STAGE_PLAN: { stage: PipelineStage; count: number }[] = [
  { stage: "prospecting", count: 8 },
  { stage: "loi-sent", count: 6 },
  { stage: "landlord-approved", count: 4 },
  { stage: "leased", count: 4 },
  { stage: "live", count: 3 },
];

const NOTE_POOL = [
  "Landlord open to a 24-month term if we cover minor repairs.",
  "Unit faces the pool — should photograph well.",
  "Property manager wants proof of insurance before signing.",
  "Rent negotiable if we take the unit as-is. Carpet needs replacing.",
  "Second unit in the same building may open up in October.",
  "HOA allows nightly rentals; got the bylaws in writing.",
  "Owner asked for a revenue share instead of flat rent. Countered flat.",
  "Needs new mattress and blackout curtains before photos.",
  "Comps run strong on weekends; midweek is the question.",
  "Waiting on the city permit number before go-live.",
  "",
  "",
];

const rng = new Rng(0xdea1);

let cursor = 0;

export const DEALS: Deal[] = STAGE_PLAN.flatMap(({ stage, count }) =>
  Array.from({ length: count }, () => {
    const analysis = ANALYSES[cursor];
    cursor += 1;

    const assumptions = deriveMarketAssumptions(analysis.strComps);
    const be = breakevenOccupancy(analysis.defaults, assumptions);
    const net = netCashFlow(
      analysis.defaults,
      assumptions,
      assumptions.marketOccupancy
    );

    // Later stages are older deals: live ones were created first.
    const stageIdx = STAGE_PLAN.findIndex((s) => s.stage === stage);
    const created = daysAgo(rng.int(15 + stageIdx * 20, 45 + stageIdx * 30));
    const updated = daysAgo(rng.int(0, 12));

    return {
      id: `d-${String(cursor).padStart(2, "0")}`,
      analysisId: analysis.id,
      address: analysis.address,
      city: analysis.city,
      stateCode: analysis.stateCode,
      marketSlug: analysis.marketSlug,
      bedrooms: analysis.bedrooms,
      stage,
      breakevenOccupancy: Math.round(be * 1000) / 1000,
      netCashFlow: Math.round(net),
      landlordIds: [], // linked by lib/mock/landlords.ts
      notes: rng.pick(NOTE_POOL),
      createdAt: created,
      updatedAt: updated,
    };
  })
);

export const DEAL_BY_ID: Map<string, Deal> = new Map(DEALS.map((d) => [d.id, d]));
