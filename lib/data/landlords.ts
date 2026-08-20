/**
 * Landlord contact data access. Private per user — mock-backed today.
 */

import { LANDLORD_BY_ID, LANDLORDS } from "@/lib/mock/landlords";
import type { Landlord } from "@/lib/mock/types";
import { simulateLatency } from "./latency";

export async function getLandlords(): Promise<Landlord[]> {
  await simulateLatency();
  return LANDLORDS;
}

export async function getLandlord(id: string): Promise<Landlord | null> {
  await simulateLatency();
  return LANDLORD_BY_ID.get(id) ?? null;
}
