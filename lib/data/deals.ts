/**
 * Pipeline deal data access. Mock-backed today. Mutations are handled
 * client-side in SessionProvider; these functions supply initial state.
 */

import { DEAL_BY_ID, DEALS } from "@/lib/mock/deals";
import type { Deal } from "@/lib/mock/types";
import { simulateLatency } from "./latency";

export async function getDeals(): Promise<Deal[]> {
  await simulateLatency();
  return DEALS;
}

export async function getDeal(id: string): Promise<Deal | null> {
  await simulateLatency();
  return DEAL_BY_ID.get(id) ?? null;
}
