/**
 * Session, billing, and activity data access. Mock-backed today; a real
 * auth provider and billing system slot in here later.
 */

import { ACTIVITY, INVOICES, SESSION_USER } from "@/lib/mock/user";
import type { ActivityEvent, Invoice, SessionUser } from "@/lib/mock/types";
import { simulateLatency } from "./latency";

export async function getSessionUser(): Promise<SessionUser> {
  await simulateLatency(120);
  return SESSION_USER;
}

export async function getInvoices(): Promise<Invoice[]> {
  await simulateLatency();
  return INVOICES;
}

export async function getActivity(limit = 12): Promise<ActivityEvent[]> {
  await simulateLatency();
  return ACTIVITY.slice(0, limit);
}
