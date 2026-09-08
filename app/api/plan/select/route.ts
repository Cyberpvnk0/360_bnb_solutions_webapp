/**
 * Put the signed-in account on a plan.
 *
 *   POST /api/plan/select   { tier: "pro" }
 *
 * THIS IS THE FULFILMENT STEP, NOT THE PAYMENT. Nothing here takes a
 * card. It writes the tier for real — every meter in the product reads
 * it from then on — which is exactly why it fulfils only when
 * MOCK_CHECKOUT=1 says this deployment is a demo, and answers 501
 * otherwise. The old client-side mock flipped a tier in browser memory
 * and toasted "you're on Pro now" while the database still said free
 * and the server refused live data; that gap is closed by making this
 * the only path.
 *
 * When Whop (or any processor) lands, its webhook verifies the payload
 * and calls the same setTier; this route then either goes away or
 * becomes the place that creates the checkout session and redirects.
 */

import { NextResponse } from "next/server";
import { TIERS, type TierId } from "@/config/app";
import { currentUser } from "@/lib/supabase/server";
import { mockCheckoutEnabled, setTier } from "@/lib/db/usage";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, reason: "signed-out" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { tier?: unknown } | null;
  const tier = body?.tier;
  if (typeof tier !== "string" || !(tier in TIERS)) {
    return NextResponse.json({ ok: false, reason: "bad-tier" }, { status: 400 });
  }

  if (!mockCheckoutEnabled()) {
    return NextResponse.json(
      { ok: false, reason: "checkout-not-connected" },
      { status: 501 }
    );
  }

  const result = await setTier(user.id, tier as TierId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: "store", detail: result.detail },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, tier: result.tier });
}
