/**
 * Internal admin metrics data access. Mock-backed today.
 */

import { ADMIN } from "@/lib/mock/admin";
import type { AdminMetrics } from "@/lib/mock/types";
import { simulateLatency } from "./latency";

export async function getAdminMetrics(): Promise<AdminMetrics> {
  await simulateLatency();
  return ADMIN;
}
