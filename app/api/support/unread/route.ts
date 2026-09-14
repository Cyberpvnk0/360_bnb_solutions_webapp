/**
 * The badge:  GET /api/support/unread
 *
 * One number, for the dot on the sidebar. Kept apart from the list
 * route because the shell asks for it on every page and must not pay
 * for a payload it throws away.
 */

import { NextResponse } from "next/server";
import { requireSupportActor } from "@/lib/auth/gate";
import { countUnread } from "@/lib/support/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const who = await requireSupportActor();
  // A signed-out caller gets a zero rather than a 401: this is only a
  // badge, and the shell that asks for it is already behind the proxy.
  if (!who.ok) return NextResponse.json({ ok: true, unread: 0 });

  const unread = await countUnread({ userId: who.user.id, staff: who.staff }).catch(
    () => 0
  );
  return NextResponse.json({ ok: true, unread, staff: who.staff });
}
