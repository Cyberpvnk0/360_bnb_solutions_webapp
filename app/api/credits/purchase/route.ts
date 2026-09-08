/**
 * Buy a top-up pack.
 *
 *   POST /api/credits/purchase   { pack: "p25" }
 *
 * THIS IS THE FULFILMENT STEP, NOT THE PAYMENT. Nothing in this product
 * takes a card yet — the subscription "checkout" is a client-side mock
 * that switches a tier in memory — and a route that hands out pack
 * credits for free would be the first thing here that gives away real
 * money. So it fulfils only when CREDITS_MOCK_CHECKOUT=1 says this is a
 * demo, and answers 501 otherwise.
 *
 * When a processor lands, its webhook calls the same grantPack with the
 * processor's payment id as the reference, and this route either goes
 * away or becomes the place that creates the checkout session. The
 * grant is idempotent on that reference, so a retried webhook cannot
 * hand out a pack twice.
 *
 * Paid plans only. A pack is for the month a plan runs dry; an account
 * on Free has no plan to run dry, and selling it analyses by the dozen
 * would undercut Starter.
 */

import { NextResponse } from "next/server";
import { CREDIT_PACKS, TIERS, type PackId } from "@/config/app";
import { currentUser } from "@/lib/supabase/server";
import { grantPack, tierOf } from "@/lib/db/usage";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, reason: "signed-out" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { pack?: unknown } | null;
  const packId = body?.pack;
  if (typeof packId !== "string" || !(packId in CREDIT_PACKS)) {
    return NextResponse.json({ ok: false, reason: "bad-pack" }, { status: 400 });
  }
  const pack = CREDIT_PACKS[packId as PackId];

  const tier = (await tierOf(user.id)) ?? "free";
  if (TIERS[tier].pullLimit <= 0) {
    return NextResponse.json({ ok: false, reason: "plan-required", tier }, { status: 403 });
  }

  if (process.env.CREDITS_MOCK_CHECKOUT !== "1") {
    return NextResponse.json(
      { ok: false, reason: "checkout-not-connected" },
      { status: 501 }
    );
  }

  // A demo reference. A real one is the processor's payment id.
  const ref = `mock:${user.id}:${Date.now()}`;
  const result = await grantPack(user.id, pack.id, ref);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: "store", detail: result.detail },
      { status: 502 }
    );
  }
  return NextResponse.json({
    ok: true,
    pack: pack.id,
    analyses: pack.analyses,
    balance: result.balance,
    granted: result.granted,
  });
}
