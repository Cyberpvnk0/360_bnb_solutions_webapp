/**
 * System health:  /api/admin/health
 *
 * Every outside service — set up or not, answering or not, and what the
 * product's own calls to it have been getting back — plus the backend's
 * own checks. Built in lib/admin/health; the reasoning lives there.
 *
 * NAMED ADMINS ONLY, AND CLOSED BY DEFAULT. This is the account-admin
 * gate, not the staff one. Staff opens to every signed-in account while
 * ADMIN_EMAILS is unset, which is right for a page of totals and wrong
 * for a page that says which keys this deployment holds, which vendors
 * are refusing it and what the server's last errors were. With no list
 * set, nobody sees it.
 *
 * Every probe is a free call, so a refresh costs nothing at any vendor.
 */

import { NextResponse } from "next/server";
import { requireAccountAdmin } from "@/lib/auth/gate";
import { buildHealthReport } from "@/lib/admin/health";

export const dynamic = "force-dynamic";
/** The probes run in parallel on 8-second clocks; this is headroom. */
export const maxDuration = 30;

export async function GET() {
  const admin = await requireAccountAdmin();
  if (!admin.ok) return admin.response;
  const report = await buildHealthReport();
  return NextResponse.json(report, { headers: { "cache-control": "no-store" } });
}
