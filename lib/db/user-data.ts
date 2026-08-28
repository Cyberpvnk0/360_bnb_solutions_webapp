"use client";

/**
 * A signed-in user's own data, in the database.
 *
 * What this replaces was worse than "kept locally": deals, landlords
 * and activity were mock rows held in React state and never written
 * anywhere at all. Saving a deal put it on screen; a refresh put the
 * seed data back. Only Deal Finder's lists reached localStorage, and
 * those still died with the browser profile.
 *
 * Everything here goes through the browser client with the publishable
 * key, which is safe precisely because every table carries a policy
 * tying rows to auth.uid(). The key cannot reach another person's data
 * even if someone reads it out of the bundle — which they can, and
 * which is fine.
 *
 * Reads are tolerant and writes are reported. A read that fails leaves
 * the user with an empty list rather than a broken page; a write that
 * fails has to say so, because the person believes their work is saved.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ActivityEvent,
  ActivityType,
  Deal,
  Landlord,
  PipelineStage,
  StrPolicy,
} from "@/lib/mock/types";

export interface UserProfile {
  tier: string;
  pullsUsed: number;
  email: string | null;
  fullName: string | null;
}

export interface UserData {
  profile: UserProfile | null;
  deals: Deal[];
  landlords: Landlord[];
  watchedMarketSlugs: string[];
  activity: ActivityEvent[];
}

export const EMPTY_USER_DATA: UserData = {
  profile: null,
  deals: [],
  landlords: [],
  watchedMarketSlugs: [],
  activity: [],
};

type Row = Record<string, unknown>;

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;
const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/**
 * A deal row back into the shape the app already renders.
 *
 * The figures that drive the pipeline — breakeven, cash flow, bedrooms —
 * live in the snapshot rather than in columns, because they belong to
 * the analysis as it stood when it was saved. Recomputing them later
 * from figures that have since moved would silently rewrite somebody's
 * record of a decision they already made.
 */
function toDeal(row: Row): Deal {
  const snap = (row.snapshot ?? {}) as Row;
  return {
    id: str(row.id),
    analysisId: str(row.analysis_id),
    address: str(row.address),
    city: str(row.city),
    stateCode: str(row.state_code),
    marketSlug: str(row.market_slug),
    bedrooms: num(snap.bedrooms),
    stage: str(row.stage, "prospecting") as PipelineStage,
    breakevenOccupancy: num(snap.breakevenOccupancy),
    netCashFlow: num(snap.netCashFlow),
    landlordIds: Array.isArray(snap.landlordIds)
      ? (snap.landlordIds as string[])
      : [],
    notes: str(snap.notes),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

function toLandlord(row: Row): Landlord {
  return {
    id: str(row.id),
    name: str(row.name),
    company: str(row.company) || undefined,
    phone: str(row.phone),
    email: str(row.email),
    unitsControlled: num(row.units_controlled),
    allowsStr: (str(row.allows_str, "unknown") as StrPolicy) ?? "unknown",
    notes: str(row.notes),
    dealIds: Array.isArray(row.deal_ids) ? (row.deal_ids as string[]) : [],
    lastContacted: str(row.last_contacted) || undefined,
    createdAt: str(row.created_at),
  };
}

function toActivity(row: Row): ActivityEvent {
  return {
    id: str(row.id),
    type: str(row.kind, "deal-saved") as ActivityType,
    message: str(row.title),
    at: str(row.created_at),
    href: str(row.href) || undefined,
  };
}

/**
 * Everything at once, in parallel.
 *
 * Five round trips run together rather than in sequence — the app shell
 * waits on all of them, so the slowest one is the cost either way and
 * serialising would just add the other four.
 */
export async function loadUserData(
  supabase: SupabaseClient,
  userId: string
): Promise<UserData> {
  const [profile, deals, landlords, watched, activity] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("deals").select("*").eq("user_id", userId).order("updated_at", { ascending: false }),
    supabase.from("landlords").select("*").eq("user_id", userId).order("updated_at", { ascending: false }),
    supabase.from("watched_markets").select("market_slug").eq("user_id", userId),
    supabase.from("activity").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(40),
  ]);

  return {
    profile: profile.data
      ? {
          tier: str((profile.data as Row).tier, "free"),
          pullsUsed: num((profile.data as Row).pulls_used),
          email: str((profile.data as Row).email) || null,
          fullName: str((profile.data as Row).full_name) || null,
        }
      : null,
    deals: (deals.data ?? []).map((r) => toDeal(r as Row)),
    landlords: (landlords.data ?? []).map((r) => toLandlord(r as Row)),
    watchedMarketSlugs: (watched.data ?? []).map((r) => str((r as Row).market_slug)),
    activity: (activity.data ?? []).map((r) => toActivity(r as Row)),
  };
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export interface WriteOutcome {
  ok: boolean;
  error: string | null;
}

const done = (error: { message: string } | null): WriteOutcome => ({
  ok: error === null,
  error: error?.message ?? null,
});

export async function persistDeal(
  supabase: SupabaseClient,
  userId: string,
  deal: Deal
): Promise<WriteOutcome> {
  const { error } = await supabase.from("deals").upsert(
    {
      // The app's own id, not one the database invents. Otherwise the
      // deal on screen and the row behind it have different names and
      // every later update targets nothing.
      id: deal.id,
      user_id: userId,
      analysis_id: deal.analysisId,
      address: deal.address,
      city: deal.city,
      state_code: deal.stateCode,
      market_slug: deal.marketSlug,
      stage: deal.stage,
      snapshot: {
        bedrooms: deal.bedrooms,
        breakevenOccupancy: deal.breakevenOccupancy,
        netCashFlow: deal.netCashFlow,
        landlordIds: deal.landlordIds,
        notes: deal.notes,
      },
      updated_at: new Date().toISOString(),
    },
    // One row per analysis per user: saving the same property twice
    // updates the deal rather than growing a second one.
    { onConflict: "user_id,analysis_id" }
  );
  return done(error);
}

export async function persistDealPatch(
  supabase: SupabaseClient,
  dealId: string,
  patch: { stage?: PipelineStage; snapshot?: Row }
): Promise<WriteOutcome> {
  const { error } = await supabase
    .from("deals")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", dealId);
  return done(error);
}

export async function persistLandlord(
  supabase: SupabaseClient,
  userId: string,
  landlord: Landlord
): Promise<WriteOutcome> {
  const { error } = await supabase.from("landlords").upsert({
    id: landlord.id,
    user_id: userId,
    name: landlord.name,
    company: landlord.company ?? null,
    phone: landlord.phone,
    email: landlord.email,
    notes: landlord.notes,
    deal_ids: landlord.dealIds,
    units_controlled: landlord.unitsControlled,
    allows_str: landlord.allowsStr,
    last_contacted: landlord.lastContacted ?? null,
    updated_at: new Date().toISOString(),
  });
  return done(error);
}

export async function persistWatch(
  supabase: SupabaseClient,
  userId: string,
  slug: string,
  watching: boolean
): Promise<WriteOutcome> {
  const { error } = watching
    ? await supabase
        .from("watched_markets")
        .upsert({ user_id: userId, market_slug: slug })
    : await supabase
        .from("watched_markets")
        .delete()
        .eq("user_id", userId)
        .eq("market_slug", slug);
  return done(error);
}

/**
 * Spend one analysis.
 *
 * Read-then-write rather than an atomic increment, which is a real
 * limitation worth naming: two tabs analysing at the same moment could
 * each read the same count and write the same new one, costing the
 * budget one pull instead of two. Correcting that needs a database
 * function, and the failure it prevents is a user getting one extra
 * analysis — not worth the machinery until the budget is tight enough
 * to notice.
 */
export async function persistPullsUsed(
  supabase: SupabaseClient,
  userId: string,
  pullsUsed: number
): Promise<WriteOutcome> {
  const { error } = await supabase
    .from("profiles")
    .update({ pulls_used: pullsUsed, updated_at: new Date().toISOString() })
    .eq("id", userId);
  return done(error);
}

export async function persistActivity(
  supabase: SupabaseClient,
  userId: string,
  event: { kind: ActivityType; title: string; href?: string }
): Promise<WriteOutcome> {
  const { error } = await supabase.from("activity").insert({
    user_id: userId,
    kind: event.kind,
    title: event.title,
    href: event.href ?? null,
  });
  return done(error);
}
