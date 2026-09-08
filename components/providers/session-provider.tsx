"use client";

/**
 * Client-side session state: who the user is, what tier they're on, how
 * many pulls they've used, their saved deals and landlord contacts.
 *
 * Every row here belongs to the signed-in account and is loaded from its
 * own tables (lib/db/user-data). Signed out there is nothing: no user,
 * no deals, no landlords — the proxy sends visitors to sign in before
 * any of this renders, and the public pages that do mount this provider
 * treat a null user as exactly that.
 */

import * as React from "react";
import { TIERS, type PackId, type Tier, type TierId } from "@/config/app";
import { currentPeriod } from "@/lib/db/usage-period";
import {
  breakevenOccupancy,
  netCashFlow,
  type DealInputs,
} from "@/lib/calc/arbitrage";
import { deriveMarketAssumptions } from "@/lib/calc/comps";
import { authConfigured } from "@/lib/supabase/config";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  loadCredits,
  loadUsage,
  loadUserData,
  persistActivity,
  persistDeal,
  persistDealPatch,
  persistLandlord,
  persistWatch,
} from "@/lib/db/user-data";
import {
  defaultLists,
  readLists,
  writeLists,
} from "@/lib/storage/deal-lists";
import type {
  ActivityEvent,
  Analysis,
  Deal,
  DealList,
  Landlord,
  PipelineStage,
  RentalListing,
  SessionUser,
} from "@/lib/mock/types";

export type UpgradeReason = "pulls" | "markets" | "deals" | "export" | "generic";

interface UpgradeState {
  open: boolean;
  reason: UpgradeReason;
  /** Analysis whose blurred result backs the modal, if any. */
  analysis?: Analysis;
}

export interface SaveDealResult {
  ok: boolean;
  reason?: "limit" | "duplicate";
  dealId?: string;
}

interface SessionContextValue {
  /** False until mock data has hydrated. */
  ready: boolean;
  user: SessionUser | null;
  tier: Tier;
  pullsUsed: number;
  pullLimit: number;
  pullsRemaining: number;
  canPull: boolean;
  marketsUsed: number;
  marketLimit: number;
  /** Pack analyses on the account, spent after the month's plan. */
  credits: number;
  /** Re-read the plan meter from the account. The server settles the
   *  count when a page spends one, so a page that just did asks once. */
  refreshUsage: () => Promise<void>;
  /** Buy a top-up pack. Resolves to the new balance, or null with a
   *  reason when the purchase could not go through. */
  buyPack: (pack: PackId) => Promise<{ balance: number } | { error: string }>;
  deals: Deal[];
  landlords: Landlord[];
  activity: ActivityEvent[];
  watchedMarketSlugs: string[];
  /** Deal Finder lists — named collections of rentals kept aside while
   *  hunting, before any of them are worth spending a pull on. */
  lists: DealList[];

  /** Spend one pull. Returns false (and opens nothing) if none remain. */
  consumePull: () => boolean;
  /** `href` is the analyzer URL that reopens this exact property — a
   *  typed address lives in its query string, not in any table, so the
   *  pipeline has to be told how to get back to it. */
  saveDeal: (analysis: Analysis, inputs?: DealInputs, href?: string) => SaveDealResult;
  isAnalysisSaved: (analysisId: string) => boolean;
  moveDeal: (dealId: string, stage: PipelineStage) => void;
  updateDeal: (dealId: string, patch: Partial<Deal>) => void;
  addLandlord: (
    data: Omit<Landlord, "id" | "createdAt" | "dealIds"> & { dealIds?: string[] }
  ) => Landlord;
  updateLandlord: (id: string, patch: Partial<Landlord>) => void;
  linkLandlordToDeal: (landlordId: string, dealId: string) => void;
  toggleWatchMarket: (slug: string) => void;
  createList: (name: string) => DealList;
  renameList: (listId: string, name: string) => void;
  deleteList: (listId: string) => void;
  /** Add or remove one rental from one list. */
  toggleListMembership: (listId: string, listing: RentalListing) => void;
  /** Which lists hold this rental. */
  listsWithListing: (listingId: string) => string[];
  /** Saved to any list at all. */
  isSaved: (listingId: string) => boolean;

  /** Switch plan through the server, which writes the tier (the test
   *  checkout today, a processor's webhook tomorrow) and answers with
   *  what actually happened. Optionally spends one pull in the same
   *  update so the header cannot skip it. */
  upgradeTo: (
    tier: TierId,
    opts?: { consumePull?: boolean }
  ) => Promise<{ ok: true } | { error: string }>;

  /** Note that an analysis was bought for this property, with the URL
   *  that reopens it — the "recent pulls" list and the activity feed
   *  are read from these. */
  recordPull: (analysis: Analysis, href: string) => void;
  /** Note a spreadsheet export, for the activity feed. */
  recordExport: (what: string, href: string) => void;

  upgrade: UpgradeState;
  openUpgrade: (opts?: { reason?: UpgradeReason; analysis?: Analysis }) => void;
  closeUpgrade: () => void;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

let idCounter = 100;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/**
 * An id for something that will be stored.
 *
 * A uuid, because the tables use one as their primary key: a counter
 * like "d-101" would be rejected, and letting the database mint its own
 * would leave the deal on screen and the row behind it with different
 * names — so every later stage change would update nothing, silently.
 *
 * Falls back to the counter where crypto is unavailable, which is only
 * ever an old browser.
 */
function storedId(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : nextId(prefix);
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  /**
   * The signed-in account's id, and the client that speaks for it.
   *
   * Null means signed out or auth not configured. Nothing is loaded
   * then: `user` stays null and every list stays empty, and the shell
   * renders its signed-out state. There is no seeded stand-in.
   */
  const [userId, setUserId] = React.useState<string | null>(null);
  const supabase = React.useMemo(
    () => (authConfigured() ? supabaseBrowser() : null),
    []
  );

  const [ready, setReady] = React.useState(false);
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [deals, setDeals] = React.useState<Deal[]>([]);
  const [landlords, setLandlords] = React.useState<Landlord[]>([]);
  const [activity, setActivity] = React.useState<ActivityEvent[]>([]);
  // Server and first client render agree on the default; this device's
  // saved lists arrive right after mount (see the bootstrap effect), so
  // there's no hydration mismatch and no flash of someone else's data.
  const [lists, setLists] = React.useState<DealList[]>(defaultLists);
  const [listsLoaded, setListsLoaded] = React.useState(false);
  const [upgrade, setUpgrade] = React.useState<UpgradeState>({
    open: false,
    reason: "generic",
  });

  React.useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      // Lists stay on the device either way: they are a scratchpad of
      // rentals worth a second look, not a record worth an account.
      const localLists = readLists(window.localStorage) ?? defaultLists();

      const auth = supabase ? await supabase.auth.getUser() : null;
      const id = auth?.data.user?.id ?? null;

      if (cancelled) return;
      setUserId(id);

      if (supabase && id) {
        // A real account: their rows, and nothing seeded. An empty
        // pipeline for a new user is the truth, and dressing it with
        // sample deals they never saved would be worse than empty.
        const [data, usage, credits] = await Promise.all([
          loadUserData(supabase, id),
          // THIS period's meter, from the table the browser cannot
          // write — not profiles.pulls_used, which it could.
          loadUsage(supabase, id, currentPeriod()),
          loadCredits(supabase, id),
        ]);
        if (cancelled) return;
        const joined = auth?.data.user?.created_at ?? new Date().toISOString();
        setUser({
          id,
          name: data.profile?.fullName ?? auth?.data.user?.email ?? "You",
          email: data.profile?.email ?? auth?.data.user?.email ?? "",
          tier: (data.profile?.tier ?? "free") as TierId,
          pullsUsed: usage.analysesUsed,
          marketsUsed: usage.marketsUsed,
          credits,
          watchedMarketSlugs: data.watchedMarketSlugs,
          joinedAt: joined,
          // No billing yet. A period end invented here would show a
          // renewal date nobody is going to be charged on, which is a
          // worse lie than an honest blank.
          periodEnd: null,
          billingCycle: null,
        });
        setDeals(data.deals);
        setLandlords(data.landlords);
        setActivity(data.activity);
      } else {
        // Signed out, or auth not configured: nobody, and nothing.
        setUser(null);
        setDeals([]);
        setLandlords([]);
        setActivity([]);
      }

      setLists(localLists);
      setListsLoaded(true);
      setReady(true);
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // Persist after the first load only — otherwise the default would
  // overwrite this device's saved lists before they're read.
  React.useEffect(() => {
    if (!listsLoaded) return;
    writeLists(window.localStorage, lists);
  }, [lists, listsLoaded]);

  const tier = TIERS[user?.tier ?? "free"];
  const pullsUsed = user?.pullsUsed ?? 0;
  const pullLimit = tier.pullLimit;
  const pullsRemaining = Math.max(0, pullLimit - pullsUsed);
  const credits = user?.credits ?? 0;
  // The plan, then the packs: an account is out only when both are.
  const canPull = pullsRemaining > 0 || credits > 0;
  const marketsUsed = user?.marketsUsed ?? 0;
  const marketLimit = tier.marketLimit;

  const refreshUsage = React.useCallback(async () => {
    if (!supabase || !userId) return;
    const [usage, balance] = await Promise.all([
      loadUsage(supabase, userId, currentPeriod()),
      loadCredits(supabase, userId),
    ]);
    setUser((prev) =>
      prev
        ? {
            ...prev,
            pullsUsed: usage.analysesUsed,
            marketsUsed: usage.marketsUsed,
            credits: balance,
          }
        : prev
    );
  }, [supabase, userId]);

  /**
   * Buy a pack. The server fulfils (or, until a processor is wired,
   * refuses with a reason), and the balance on screen is whatever it
   * says afterwards — never a number this side made up.
   */
  const buyPack = React.useCallback(
    async (pack: PackId): Promise<{ balance: number } | { error: string }> => {
      if (!user) return { error: "Sign in to buy a pack." };
      try {
        const res = await fetch("/api/credits/purchase", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pack }),
        });
        const body = (await res.json().catch(() => null)) as
          | { ok: true; balance: number }
          | { ok: false; reason?: string }
          | null;
        if (!body?.ok) {
          const reason = body && "reason" in body ? body.reason : undefined;
          return {
            error:
              reason === "checkout-not-connected"
                ? "Checkout isn't connected yet — packs go live with billing."
                : reason === "plan-required"
                  ? "Packs top up a paid plan. Pick a plan first."
                  : "That purchase didn't go through.",
          };
        }
        setUser((prev) => (prev ? { ...prev, credits: body.balance } : prev));
        return { balance: body.balance };
      } catch {
        return { error: "That purchase didn't go through." };
      }
    },
    [user]
  );

  /**
   * Write through to the account, when there is one.
   *
   * Every mutation below updates React state first so the UI responds
   * immediately, then persists. Signed out there is no account to write
   * to and `persist` is a no-op — and no screen that mutates is
   * reachable signed out.
   *
   * A failure is logged rather than swallowed. It cannot block the
   * interaction — the change is already on screen — but a person who
   * believes their pipeline is saved and finds it gone tomorrow
   * deserves to have had it recorded somewhere.
   */
  const persist = React.useCallback(
    (
      what: string,
      run: (client: NonNullable<typeof supabase>, id: string) => Promise<{ ok: boolean; error: string | null }>
    ) => {
      if (!supabase || !userId) return;
      void run(supabase, userId).then((r) => {
        if (!r.ok) console.error(`[arbicore] failed to save ${what}:`, r.error);
      });
    },
    [supabase, userId]
  );

  const pushActivity = React.useCallback(
    (event: Omit<ActivityEvent, "id">) => {
      setActivity((prev) => [{ ...event, id: nextId("ev") }, ...prev]);
      persist("activity", (client, id) =>
        persistActivity(client, id, {
          kind: event.type,
          title: event.message,
          href: event.href,
        })
      );
    },
    [persist]
  );

  /**
   * A pre-flight answer, not the meter.
   *
   * The meter is server-side now (lib/db/usage): the analyzer page
   * claims the analysis against the plan while it renders, atomically,
   * from a table the browser cannot write. This only bumps the local
   * count so the header moves at once; the page then calls
   * refreshUsage and the true figure replaces it. Nothing is written
   * from here, and nothing here is trusted.
   */
  const consumePull = React.useCallback((): boolean => {
    if (!user) return false;
    const planLeft = TIERS[user.tier].pullLimit - user.pullsUsed > 0;
    if (!planLeft && user.credits <= 0) return false;
    // Mirror the server's order of spend: plan first, then a pack.
    setUser((prev) =>
      prev
        ? planLeft
          ? { ...prev, pullsUsed: prev.pullsUsed + 1 }
          : { ...prev, pullsUsed: prev.pullsUsed + 1, credits: prev.credits - 1 }
        : prev
    );
    return true;
  }, [user]);

  const isAnalysisSaved = React.useCallback(
    (analysisId: string) => deals.some((d) => d.analysisId === analysisId),
    [deals]
  );

  const saveDeal = React.useCallback(
    (analysis: Analysis, inputs?: DealInputs, href?: string): SaveDealResult => {
      if (deals.some((d) => d.analysisId === analysis.id)) {
        return { ok: false, reason: "duplicate" };
      }
      if (deals.length >= tier.savedDealLimit) {
        return { ok: false, reason: "limit" };
      }
      // Save the scenario the user is looking at: their edited inputs when
      // provided, the comp defaults otherwise.
      const effective = inputs ?? analysis.defaults;
      const assumptions = deriveMarketAssumptions(analysis.strComps);
      const now = new Date().toISOString().slice(0, 10);
      const deal: Deal = {
        id: storedId("d"),
        analysisId: analysis.id,
        analysisHref: href,
        address: analysis.address,
        city: analysis.city,
        stateCode: analysis.stateCode,
        marketSlug: analysis.marketSlug,
        bedrooms: analysis.bedrooms,
        stage: "prospecting",
        // Whole-point precision so the pipeline shows exactly what the
        // analysis gauge showed.
        breakevenOccupancy:
          Math.round(breakevenOccupancy(effective, assumptions) * 100) / 100,
        netCashFlow: Math.round(
          netCashFlow(effective, assumptions, assumptions.marketOccupancy)
        ),
        landlordIds: [],
        notes: "",
        createdAt: now,
        updatedAt: now,
      };
      setDeals((prev) => [deal, ...prev]);
      persist("deal", (client, id) => persistDeal(client, id, deal));
      pushActivity({
        type: "deal-saved",
        message: `Saved ${analysis.address}, ${analysis.city} to Prospecting`,
        at: new Date().toISOString(),
        href: "/pipeline",
      });
      return { ok: true, dealId: deal.id };
    },
    [deals, tier.savedDealLimit, pushActivity, persist]
  );

  const moveDeal = React.useCallback(
    (dealId: string, stage: PipelineStage) => {
      setDeals((prev) =>
        prev.map((d) =>
          d.id === dealId
            ? { ...d, stage, updatedAt: new Date().toISOString().slice(0, 10) }
            : d
        )
      );
      persist("pipeline stage", (client) =>
        persistDealPatch(client, dealId, { stage })
      );
    },
    [persist]
  );

  const updateDeal = React.useCallback(
    (dealId: string, patch: Partial<Deal>) => {
      let updated: Deal | undefined;
      setDeals((prev) =>
        prev.map((d) => {
          if (d.id !== dealId) return d;
          updated = { ...d, ...patch, updatedAt: new Date().toISOString().slice(0, 10) };
          return updated;
        })
      );
      // The whole row rather than the patch: notes and landlord links
      // live in the snapshot, so a partial write would drop whichever
      // of them this particular edit did not touch.
      if (updated) {
        const row = updated;
        persist("deal", (client, id) => persistDeal(client, id, row));
      }
    },
    [persist]
  );

  const addLandlord = React.useCallback(
    (
      data: Omit<Landlord, "id" | "createdAt" | "dealIds"> & { dealIds?: string[] }
    ): Landlord => {
      const landlord: Landlord = {
        ...data,
        id: storedId("ll"),
        dealIds: data.dealIds ?? [],
        createdAt: new Date().toISOString().slice(0, 10),
      };
      setLandlords((prev) => [landlord, ...prev]);
      persist("landlord", (client, id) => persistLandlord(client, id, landlord));
      pushActivity({
        type: "landlord-added",
        message: `Added landlord contact ${landlord.name}`,
        at: new Date().toISOString(),
        href: "/landlords",
      });
      return landlord;
    },
    [pushActivity, persist]
  );

  const updateLandlord = React.useCallback(
    (id: string, patch: Partial<Landlord>) => {
      let updated: Landlord | undefined;
      setLandlords((prev) =>
        prev.map((l) => {
          if (l.id !== id) return l;
          updated = { ...l, ...patch };
          return updated;
        })
      );
      if (updated) {
        const row = updated;
        persist("landlord", (client, uid) => persistLandlord(client, uid, row));
      }
    },
    [persist]
  );

  const linkLandlordToDeal = React.useCallback(
    (landlordId: string, dealId: string) => {
      setLandlords((prev) =>
        prev.map((l) =>
          l.id === landlordId && !l.dealIds.includes(dealId)
            ? { ...l, dealIds: [...l.dealIds, dealId] }
            : l
        )
      );
      setDeals((prev) =>
        prev.map((d) =>
          d.id === dealId && !d.landlordIds.includes(landlordId)
            ? { ...d, landlordIds: [...d.landlordIds, landlordId] }
            : d
        )
      );
    },
    []
  );

  const toggleWatchMarket = React.useCallback(
    (slug: string) => {
      const already = (user?.watchedMarketSlugs ?? []).includes(slug);
      // Decided out here so the write and the state change agree on
      // which direction this went. Reading it back out of setState
      // would be a guess, and an earlier draft had two variables named
      // `watching` meaning opposite things.
      const nowWatching = !already;

      setUser((prev) =>
        prev
          ? {
              ...prev,
              watchedMarketSlugs: nowWatching
                ? [...prev.watchedMarketSlugs, slug]
                : prev.watchedMarketSlugs.filter((s) => s !== slug),
            }
          : prev
      );

      persist("watched market", (client, id) =>
        persistWatch(client, id, slug, nowWatching)
      );
    },
    [user, persist]
  );

  const createList = React.useCallback((name: string) => {
    const created: DealList = {
      id: nextId("list"),
      name: name.trim() || "Untitled list",
      createdAt: new Date().toISOString().slice(0, 10),
      listings: [],
    };
    setLists((prev) => [...prev, created]);
    return created;
  }, []);

  const renameList = React.useCallback((listId: string, name: string) => {
    setLists((prev) =>
      prev.map((l) =>
        l.id === listId ? { ...l, name: name.trim() || l.name } : l
      )
    );
  }, []);

  const deleteList = React.useCallback((listId: string) => {
    setLists((prev) => prev.filter((l) => l.id !== listId));
  }, []);

  const toggleListMembership = React.useCallback(
    (listId: string, listing: RentalListing) => {
      setLists((prev) =>
        prev.map((l) => {
          if (l.id !== listId) return l;
          const has = l.listings.some((x) => x.id === listing.id);
          return {
            ...l,
            listings: has
              ? l.listings.filter((x) => x.id !== listing.id)
              : [listing, ...l.listings],
          };
        })
      );
    },
    []
  );

  const listsWithListing = React.useCallback(
    (listingId: string) =>
      lists
        .filter((l) => l.listings.some((x) => x.id === listingId))
        .map((l) => l.id),
    [lists]
  );

  const isSaved = React.useCallback(
    (listingId: string) =>
      lists.some((l) => l.listings.some((x) => x.id === listingId)),
    [lists]
  );


  /**
   * Switch plan — through the server, never around it.
   *
   * The old version flipped the tier in browser memory and let the UI
   * say "you're on Pro now" while the database still said free and
   * every server-side meter refused. The header follows the database
   * now: persist first, then mirror. The route answers 501 until a
   * deployment says it is a demo (MOCK_CHECKOUT=1) or a processor's
   * webhook is the thing writing tiers, and the caller gets a message
   * it can show rather than a toast that lies.
   */
  const upgradeTo = React.useCallback(
    async (
      tierId: TierId,
      opts?: { consumePull?: boolean }
    ): Promise<{ ok: true } | { error: string }> => {
      if (!user) return { error: "Sign in to choose a plan." };
      try {
        const res = await fetch("/api/plan/select", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tier: tierId }),
        });
        const body = (await res.json().catch(() => null)) as
          | { ok: true; tier: TierId }
          | { ok: false; reason?: string }
          | null;
        if (!body?.ok) {
          const reason = body && "reason" in body ? body.reason : undefined;
          return {
            error:
              reason === "checkout-not-connected"
                ? "Checkout isn't connected yet — plans go live with billing."
                : "That plan change didn't go through.",
          };
        }
      } catch {
        return { error: "That plan change didn't go through." };
      }
      setUser((prev) => {
        if (!prev) return prev;
        const limit = TIERS[tierId].pullLimit;
        // Clamp usage into the new limit, and spend the promised pull in
        // the same update so no stale closure can skip it. The server
        // settles the true count on the next page; this keeps the header
        // honest in the meantime.
        const clamped = Math.min(prev.pullsUsed, limit);
        const pullsUsed =
          opts?.consumePull && limit - clamped > 0 ? clamped + 1 : clamped;
        return {
          ...prev,
          tier: tierId,
          pullsUsed,
          marketsUsed: Math.min(prev.marketsUsed, TIERS[tierId].marketLimit),
        };
      });
      return { ok: true };
    },
    [user]
  );

  const recordPull = React.useCallback(
    (analysis: Analysis, href: string) => {
      pushActivity({
        type: "pull",
        message: `Analyzed ${analysis.address}, ${analysis.city}`,
        at: new Date().toISOString(),
        href,
      });
    },
    [pushActivity]
  );

  const recordExport = React.useCallback(
    (what: string, href: string) => {
      pushActivity({
        type: "export",
        message: `Exported ${what}`,
        at: new Date().toISOString(),
        href,
      });
    },
    [pushActivity]
  );

  const openUpgrade = React.useCallback(
    (opts?: { reason?: UpgradeReason; analysis?: Analysis }) => {
      setUpgrade({
        open: true,
        reason: opts?.reason ?? "generic",
        analysis: opts?.analysis,
      });
    },
    []
  );

  const closeUpgrade = React.useCallback(() => {
    setUpgrade((prev) => ({ ...prev, open: false }));
  }, []);

  const value: SessionContextValue = {
    ready,
    user,
    tier,
    pullsUsed,
    marketsUsed,
    marketLimit,
    credits,
    refreshUsage,
    buyPack,
    pullLimit,
    pullsRemaining,
    canPull,
    deals,
    landlords,
    activity,
    watchedMarketSlugs: user?.watchedMarketSlugs ?? [],
    lists,
    consumePull,
    saveDeal,
    isAnalysisSaved,
    moveDeal,
    updateDeal,
    addLandlord,
    updateLandlord,
    linkLandlordToDeal,
    toggleWatchMarket,
    createList,
    renameList,
    deleteList,
    toggleListMembership,
    listsWithListing,
    isSaved,
    upgradeTo,
    recordPull,
    recordExport,
    upgrade,
    openUpgrade,
    closeUpgrade,
  };

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
