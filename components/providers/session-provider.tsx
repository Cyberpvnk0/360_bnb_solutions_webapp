"use client";

/**
 * Client-side session state: who the user is, what tier they're on, how
 * many pulls they've used, their saved deals and landlord contacts.
 *
 * UI-only pass: state lives in memory, seeded from lib/data on mount.
 * When auth + billing + persistence arrive, this provider keeps its API
 * and swaps its internals for server calls.
 */

import * as React from "react";
import { TIERS, type Tier, type TierId } from "@/config/app";
import {
  breakevenOccupancy,
  netCashFlow,
  type DealInputs,
} from "@/lib/calc/arbitrage";
import { deriveMarketAssumptions } from "@/lib/calc/comps";
import {
  getActivity,
  getDeals,
  getLandlords,
  getSessionUser,
} from "@/lib/data";
import { MOCK_TODAY } from "@/lib/mock/seed";
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

export type UpgradeReason = "pulls" | "deals" | "generic";

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
  deals: Deal[];
  landlords: Landlord[];
  activity: ActivityEvent[];
  watchedMarketSlugs: string[];
  /** Deal Finder lists — named collections of rentals kept aside while
   *  hunting, before any of them are worth spending a pull on. */
  lists: DealList[];

  /** Spend one pull. Returns false (and opens nothing) if none remain. */
  consumePull: () => boolean;
  saveDeal: (analysis: Analysis, inputs?: DealInputs) => SaveDealResult;
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

  /** Demo-only: preview the product as another tier. */
  setTier: (tier: TierId) => void;
  /** Mock checkout: switch tier (clamping usage into the new limit) and
   *  optionally spend one pull in the same atomic update. */
  upgradeTo: (tier: TierId, opts?: { consumePull?: boolean }) => void;

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

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [deals, setDeals] = React.useState<Deal[]>([]);
  const [landlords, setLandlords] = React.useState<Landlord[]>([]);
  const [activity, setActivity] = React.useState<ActivityEvent[]>([]);
  // Everyone starts with one list so "Add to list" is one click, not two.
  const [lists, setLists] = React.useState<DealList[]>([
    {
      id: "list-default",
      name: "My shortlist",
      createdAt: MOCK_TODAY,
      listings: [],
    },
  ]);
  const [upgrade, setUpgrade] = React.useState<UpgradeState>({
    open: false,
    reason: "generic",
  });

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([getSessionUser(), getDeals(), getLandlords(), getActivity()]).then(
      ([u, d, l, a]) => {
        if (cancelled) return;
        setUser(u);
        setDeals(d);
        setLandlords(l);
        setActivity(a);
        setReady(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const tier = TIERS[user?.tier ?? "free"];
  const pullsUsed = user?.pullsUsed ?? 0;
  const pullLimit = tier.pullLimit;
  const pullsRemaining = Math.max(0, pullLimit - pullsUsed);
  const canPull = pullsRemaining > 0;

  const pushActivity = React.useCallback((event: Omit<ActivityEvent, "id">) => {
    setActivity((prev) => [{ ...event, id: nextId("ev") }, ...prev]);
  }, []);

  const consumePull = React.useCallback((): boolean => {
    if (!user) return false;
    if (TIERS[user.tier].pullLimit - user.pullsUsed <= 0) return false;
    setUser((prev) => (prev ? { ...prev, pullsUsed: prev.pullsUsed + 1 } : prev));
    return true;
  }, [user]);

  const isAnalysisSaved = React.useCallback(
    (analysisId: string) => deals.some((d) => d.analysisId === analysisId),
    [deals]
  );

  const saveDeal = React.useCallback(
    (analysis: Analysis, inputs?: DealInputs): SaveDealResult => {
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
        id: nextId("d"),
        analysisId: analysis.id,
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
      pushActivity({
        type: "deal-saved",
        message: `Saved ${analysis.address}, ${analysis.city} to Prospecting`,
        at: new Date().toISOString(),
        href: "/pipeline",
      });
      return { ok: true, dealId: deal.id };
    },
    [deals, tier.savedDealLimit, pushActivity]
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
    },
    []
  );

  const updateDeal = React.useCallback((dealId: string, patch: Partial<Deal>) => {
    setDeals((prev) =>
      prev.map((d) =>
        d.id === dealId
          ? { ...d, ...patch, updatedAt: new Date().toISOString().slice(0, 10) }
          : d
      )
    );
  }, []);

  const addLandlord = React.useCallback(
    (
      data: Omit<Landlord, "id" | "createdAt" | "dealIds"> & { dealIds?: string[] }
    ): Landlord => {
      const landlord: Landlord = {
        ...data,
        id: nextId("ll"),
        dealIds: data.dealIds ?? [],
        createdAt: new Date().toISOString().slice(0, 10),
      };
      setLandlords((prev) => [landlord, ...prev]);
      pushActivity({
        type: "landlord-added",
        message: `Added landlord contact ${landlord.name}`,
        at: new Date().toISOString(),
        href: "/landlords",
      });
      return landlord;
    },
    [pushActivity]
  );

  const updateLandlord = React.useCallback(
    (id: string, patch: Partial<Landlord>) => {
      setLandlords((prev) =>
        prev.map((l) => (l.id === id ? { ...l, ...patch } : l))
      );
    },
    []
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

  const toggleWatchMarket = React.useCallback((slug: string) => {
    setUser((prev) => {
      if (!prev) return prev;
      const watching = prev.watchedMarketSlugs.includes(slug);
      return {
        ...prev,
        watchedMarketSlugs: watching
          ? prev.watchedMarketSlugs.filter((s) => s !== slug)
          : [...prev.watchedMarketSlugs, slug],
      };
    });
  }, []);

  const createList = React.useCallback((name: string) => {
    const created: DealList = {
      id: nextId("list"),
      name: name.trim() || "Untitled list",
      createdAt: MOCK_TODAY,
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

  const setTier = React.useCallback((tierId: TierId) => {
    setUser((prev) => {
      if (!prev) return prev;
      const limit = TIERS[tierId].pullLimit;
      return { ...prev, tier: tierId, pullsUsed: Math.min(prev.pullsUsed, limit) };
    });
  }, []);

  const upgradeTo = React.useCallback(
    (tierId: TierId, opts?: { consumePull?: boolean }) => {
      setUser((prev) => {
        if (!prev) return prev;
        const limit = TIERS[tierId].pullLimit;
        // Atomic: switch tier, clamp usage into the new limit, and spend the
        // promised pull in the same update so no stale closure can skip it.
        const clamped = Math.min(prev.pullsUsed, limit);
        const pullsUsed =
          opts?.consumePull && limit - clamped > 0 ? clamped + 1 : clamped;
        return { ...prev, tier: tierId, pullsUsed };
      });
    },
    []
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
    setTier,
    upgradeTo,
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
