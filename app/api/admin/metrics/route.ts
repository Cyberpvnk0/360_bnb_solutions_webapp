/**
 * The operator's numbers:  /api/admin/metrics
 *
 * Staff only — the allowlist in ADMIN_EMAILS, checked against the
 * session's verified email. The body is every account's tier, usage
 * and balance, read with the secret key, so the gate is the whole of
 * this route's security and runs before anything is read.
 */

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/gate";
import { readAdminMetrics } from "@/lib/admin/metrics";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await requireStaff();
  if (!staff.ok) return staff.response;
  const metrics = await readAdminMetrics();
  return NextResponse.json(metrics, { headers: { "cache-control": "no-store" } });
}
