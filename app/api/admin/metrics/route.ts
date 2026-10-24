/**
 * The operator's numbers:  /api/admin/metrics
 *
 * Staff only — the allowlist in ADMIN_EMAILS, checked against the
 * session's verified email. The body is every account's tier, usage
 * and balance, read with the secret key, so the gate is the whole of
 * this route's security and runs before anything is read.
 */

import { NextResponse } from "next/server";
import { isSupportStaff, requireStaff } from "@/lib/auth/gate";
import { readAdminMetrics, type AdminPayload } from "@/lib/admin/metrics";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await requireStaff();
  if (!staff.ok) return staff.response;
  const metrics = await readAdminMetrics();
  // Whether THIS viewer may act on an account — the same fail-closed
  // rule the account route applies. The list itself stays on the server.
  const payload: AdminPayload = { ...metrics, accountAdmin: isSupportStaff(staff.user) };
  return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
}
