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
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { DEFAULT_TIER, TIERS, type PackId, type Tier, type TierId } from "@/config/app";
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
  deleteListRow,
  loadCredits,
  loadUsage,
  loadUserData,
  persistActivity,
  persistDeal,
  persistDealPatch,
  persistLandlord,
  persistList,
  persistListItem,
  persistWatch,
  removeListItem,
} from "@/lib/db/user-data";
import { readLists, writeLists } from "@/lib/storage/deal-lists";
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

export type UpgradeReason = "credits" | "deals" | "export" | "generic";

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
  /** Set when the account could not be loaded in this tab — the shell
   *  shows a way out instead of skeletons that never resolve. */
  bootError: string | null;
  /** False until mock data has hydrated. */
  ready: boolean;
  user: SessionUser | null;
  tier: Tier;
  /** Credits spent this month: first analyses and first market or ZIP
   *  searches, together. */
  creditsUsed: number;
  creditLimit: number;
  creditsRemaining: number;
  /** Whether one more credit can be spent — from the plan or a pack. */
  canSpend: boolean;
  /** Pack credits on the account, spent after the month's plan. */
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

  /** Spend one credit. Returns false (and opens nothing) if none remain. */
  spendCredit: () => boolean;
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
    opts?: { spendCredit?: boolean }
  ) => Promise<{ ok: true } | { error: string }>;

  /** Change the display name — written by the server, mirrored here
   *  once it says so. */
  updateName: (name: string) => Promise<{ ok: true } | { error: string }>;
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

/**
 * This device's old lists, moved up to the account ONCE.
 *
 * Before lists were rows they lived in localStorage, so a staff tester
 * may have a shortlist sitting in this browser that the account has
 * never seen. When the account has NO lists and this device has some,
 * the device's lists are written to the account. Nothing else happens
 * on boot: no default list is seeded (a list is made the moment
 * somebody names one), so two tabs booting at once cannot each invent
 * a "My shortlist", and deleting the last list leaves none.
 *
 * ONCE MEANS ONCE-SUCCESSFULLY. The device copy is cleared only after
 * every list and every item wrote. A failed write — the tables not yet
 * created, a token the store rejects, a dropped connection — leaves the
 * device copy where it was, says so, and returns nothing, so the same
 * boot tomorrow tries again with nothing lost in between.
 *
 * NEVER on the strength of a failed read: an account whose lists could
 * not be read is not an account with no lists. The caller checks that
 * before calling this.
 */
async function adoptLists(
  supabase: NonNullable<ReturnType<typeof supabaseBrowser>>,
  userId: string
): Promise<DealList[] | null> {
  const run = async (): Promise<DealList[] | null> => {
    // Read INSIDE the lock: a second tab booting the same profile at
    // the same moment waits here, then finds the key already cleared
    // by the first and moves nothing twice.
    const local = (readLists(window.localStorage) ?? []).filter(
      (l) => l.listings.length > 0
    );
    if (local.length === 0) return null;

    const seed: DealList[] = local.map((l) => ({
      ...l,
      // Fresh ids: the device's were counters, and the table wants uuids.
      id: storedId("list"),
      name: l.name.trim() || "Untitled list",
      createdAt: new Date().toISOString().slice(0, 10),
    }));

    let failures = 0;
    for (const list of seed) {
      const made = await persistList(supabase, userId, list);
      if (!made.ok) {
        failures += 1;
        console.error("[aircore] failed to move a list to the account:", made.error);
        continue;
      }
      for (const listing of list.listings) {
        const put = await persistListItem(supabase, userId, list.id, listing);
        if (!put.ok) {
          failures += 1;
          console.error("[aircore] failed to move a saved rental:", put.error);
        }
      }
    }

    if (failures > 0) {
      toast.error("Your saved lists from this device couldn't be moved to your account yet.", {
        description: "They are still on this device. Reload to try again.",
      });
      return null;
    }
    // Moved. Clearing the device copy is what makes this once.
    writeLists(window.localStorage, []);
    return seed;
  };

  // One tab at a time per browser profile. Two tabs restored together
  // both boot, both see an account with no lists, and without this both
  // would read the same device copy and write it twice under different
  // ids. Browsers without the Web Locks API run it unguarded.
  if (typeof navigator !== "undefined" && "locks" in navigator && navigator.locks) {
    return navigator.locks.request("aircore.adopt-lists", run);
  }
  return run();
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
  const [bootError, setBootError] = React.useState<string | null>(null);
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [deals, setDeals] = React.useState<Deal[]>([]);
  const [landlords, setLandlords] = React.useState<Landlord[]>([]);
  const [activity, setActivity] = React.useState<ActivityEvent[]>([]);
  // Lists are the account's rows now, loaded with everything else.
  const [lists, setLists] = React.useState<DealList[]>([]);
  const [upgrade, setUpgrade] = React.useState<UpgradeState>({
    open: false,
    reason: "generic",
  });

  /** Bumped to load the account again — after a sign-in that happened
   *  in this tab, or a sign-out. The provider outlives those navigations
   *  (it sits in the root layout), so a boot that ran once, signed out,
   *  would otherwise be the boot that stands for the whole session. */
  const [bootNonce, setBootNonce] = React.useState(0);

  // The id the last boot settled on, readable from the listener below
  // without re-subscribing every time it changes.
  const userIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  React.useEffect(() => {
    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      // Only a CHANGE of who is signed in warrants a reload. Token
      // refreshes fire this too and change nothing the page shows.
      if (event === "SIGNED_OUT") setBootNonce((n) => n + 1);
      if (event === "SIGNED_IN" && session?.user.id !== userIdRef.current) {
        setBootNonce((n) => n + 1);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  React.useEffect(() => {
    let cancelled = false;

    /**
     * Load the account. EVERY PATH ENDS IN `ready`. An earlier version
     * let a thrown error leave `ready` false forever, which rendered as
     * a page of skeletons with nothing to click — the worst possible
     * failure, because it looks like loading. Now a failure is a
     * message, and the shell shows a way out.
     */
    const boot = async () => {
      setBootError(null);
      try {
        // Who is signed in. The cookie session first — no round trip,
        // and it is what the server already verified for this page —
        // then the auth server if the cookie yields nothing.
        let id: string | null = null;
        let authEmail: string | undefined;
        let createdAt: string | undefined;
        if (supabase) {
          const { data: sessionData } = await supabase.auth.getSession();
          let authUser = sessionData.session?.user ?? null;
          if (!authUser) {
            const { data, error } = await supabase.auth.getUser();
            if (error) console.warn("[aircore] auth.getUser:", error.message);
            authUser = data.user;
          }
          id = authUser?.id ?? null;
          authEmail = authUser?.email;
          createdAt = authUser?.created_at;
        }

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
          setUser({
            id,
            name: data.profile?.fullName ?? authEmail ?? "You",
            email: data.profile?.email ?? authEmail ?? "",
            tier: (data.profile?.tier ?? DEFAULT_TIER) as TierId,
            pullsUsed: usage.analysesUsed,
            marketsUsed: usage.marketsUsed,
            credits,
            watchedMarketSlugs: data.watchedMarketSlugs,
            joinedAt: createdAt ?? new Date().toISOString(),
            // No billing yet. A period end invented here would show a
            // renewal date nobody is going to be charged on, which is a
            // worse lie than an honest blank.
            periodEnd: null,
            billingCycle: null,
          });
          setDeals(data.deals);
          setLandlords(data.landlords);
          setActivity(data.activity);
          setLists(data.lists);

          // A table that could not be read is not an empty table. Say
          // so, once, rather than showing a clean empty account.
          if (data.failed.length > 0) {
            console.error("[aircore] some account data failed to load:", data.failed);
            toast.error("Some of your saved data didn't load.", {
              description: "Reload to try again. Nothing was changed.",
            });
          }

          // This device's pre-account lists, moved up — AFTER the page
          // is usable, never blocking it, and never when the lists read
          // failed (an unreadable account is not an empty one).
          const listsReadOk = !data.failed.some((f) => f.startsWith("deal_list"));
          if (listsReadOk && data.lists.length === 0) {
            void adoptLists(supabase, id).then((adopted) => {
              // Merge, never replace: the person may have made a list
              // in the seconds this took.
              if (adopted && !cancelled) setLists((prev) => [...prev, ...adopted]);
            });
          }
        } else {
          // Signed out, or auth not configured: nobody, and nothing.
          setUser(null);
          setDeals([]);
          setLandlords([]);
          setActivity([]);
          setLists([]);
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        console.error("[aircore] account failed to load:", error);
        setBootError(message);
      } finally {
        if (!cancelled) setReady(true);
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [supabase, bootNonce]);

  const tier = TIERS[user?.tier ?? DEFAULT_TIER] ?? TIERS.free;
  // One pool: analyses and market searches, added up.
  const creditsUsed = (user?.pullsUsed ?? 0) + (user?.marketsUsed ?? 0);
  const creditLimit = tier.creditLimit;
  const creditsRemaining = Math.max(0, creditLimit - creditsUsed);
  const credits = user?.credits ?? 0;
  // The plan, then the packs: an account is out only when both are.
  const canSpend = creditsRemaining > 0 || credits > 0;

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
        if (!r.ok) console.error(`[aircore] failed to save ${what}:`, r.error);
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
  const spendCredit = React.useCallback((): boolean => {
    if (!user) return false;
    const planLeft = TIERS[user.tier].creditLimit - (user.pullsUsed + user.marketsUsed) > 0;
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
        href: "/saved?tab=landlords",
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

  /** Writes of list rows still in flight, by list id. An item added to
   *  a list created a moment ago must not race the list's own insert —
   *  the item row points at the list row, and the database refuses an
   *  item whose list is not there yet. */
  const listWrites = React.useRef(new Map<string, Promise<unknown>>());

  const createList = React.useCallback(
    (name: string) => {
      const created: DealList = {
        id: storedId("list"),
        name: name.trim() || "Untitled list",
        createdAt: new Date().toISOString().slice(0, 10),
        listings: [],
      };
      setLists((prev) => [...prev, created]);
      persist("list", (client, id) => {
        const write = persistList(client, id, created);
        listWrites.current.set(created.id, write);
        void write.finally(() => listWrites.current.delete(created.id));
        return write;
      });
      return created;
    },
    [persist]
  );

  const renameList = React.useCallback(
    (listId: string, name: string) => {
      const next = name.trim();
      if (!next) return;
      setLists((prev) =>
        prev.map((l) => (l.id === listId ? { ...l, name: next } : l))
      );
      persist("list name", (client, id) =>
        persistList(client, id, { id: listId, name: next })
      );
    },
    [persist]
  );

  const deleteList = React.useCallback(
    (listId: string) => {
      setLists((prev) => prev.filter((l) => l.id !== listId));
      persist("list", (client) => deleteListRow(client, listId));
    },
    [persist]
  );

  const toggleListMembership = React.useCallback(
    (listId: string, listing: RentalListing) => {
      const has = lists
        .find((l) => l.id === listId)
        ?.listings.some((x) => x.id === listing.id);
      setLists((prev) =>
        prev.map((l) => {
          if (l.id !== listId) return l;
          return {
            ...l,
            listings: has
              ? l.listings.filter((x) => x.id !== listing.id)
              : [listing, ...l.listings],
          };
        })
      );
      persist(has ? "list removal" : "list item", async (client, id) => {
        // After the list itself, if that write is still on its way.
        await listWrites.current.get(listId)?.catch(() => undefined);
        return has
          ? removeListItem(client, listId, listing.id)
          : persistListItem(client, id, listId, listing);
      });
    },
    [lists, persist]
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
      opts?: { spendCredit?: boolean }
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
        const limit = TIERS[tierId].creditLimit;
        // Spend the promised credit in the same update so no stale
        // closure can skip it. The server settles the true count on the
        // next page; this keeps the header honest in the meantime.
        const used = prev.pullsUsed + prev.marketsUsed;
        const pullsUsed =
          opts?.spendCredit && limit - used > 0 ? prev.pullsUsed + 1 : prev.pullsUsed;
        return { ...prev, tier: tierId, pullsUsed };
      });
      return { ok: true };
    },
    [user]
  );

  const updateName = React.useCallback(
    async (name: string): Promise<{ ok: true } | { error: string }> => {
      const next = name.trim();
      if (!next) return { error: "A name can't be blank." };
      try {
        const res = await fetch("/api/profile", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fullName: next }),
        });
        const body = (await res.json().catch(() => null)) as
          | { ok: true; fullName: string }
          | { ok: false; hint?: string }
          | null;
        if (!body?.ok) {
          return { error: (body && "hint" in body && body.hint) || "That didn't save." };
        }
        setUser((prev) => (prev ? { ...prev, name: body.fullName } : prev));
        return { ok: true };
      } catch {
        return { error: "That didn't save." };
      }
    },
    []
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
    bootError,
    ready,
    user,
    tier,
    creditsUsed,
    creditLimit,
    creditsRemaining,
    canSpend,
    credits,
    refreshUsage,
    buyPack,
    deals,
    landlords,
    activity,
    watchedMarketSlugs: user?.watchedMarketSlugs ?? [],
    lists,
    spendCredit,
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
    updateName,
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
