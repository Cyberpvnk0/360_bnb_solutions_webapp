"use client";

/**
 * /saved — everything a hunter has kept: the rental lists built in the
 * Deal Finder, and the landlord book. Tab state lives in the URL
 * (?tab=) so a deep link lands on the right pane and back/forward walk
 * the tabs.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/primitives/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LandlordsView } from "@/components/landlords/landlords-view";
import { useSession } from "@/components/providers/session-provider";
import { fmtNum } from "@/lib/format";
import { ListsTab } from "./lists-tab";

export type SavedTab = "lists" | "landlords";

export function SavedScreen({ initialTab }: { initialTab: SavedTab }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { lists, landlords } = useSession();

  const raw = searchParams.get("tab");
  const tab: SavedTab = raw === "landlords" || raw === "lists" ? raw : initialTab;

  const handleTabChange = (value: string) => {
    router.replace(`/saved?tab=${value}`, { scroll: false });
  };


  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
      <PageHeader
        title="Saved"
        description="The rentals you shortlisted and the landlords behind them."
      />

      <Tabs value={tab} onValueChange={handleTabChange} className="mt-8">
        <TabsList>
          <TabsTrigger value="lists">
            Lists
            <span className="ml-1.5 text-[11px] text-muted-foreground tabular">
              {fmtNum(lists.length)}
            </span>
          </TabsTrigger>
          <TabsTrigger value="landlords">
            Landlords
            <span className="ml-1.5 text-[11px] text-muted-foreground tabular">
              {fmtNum(landlords.length)}
            </span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="lists" className="mt-8">
          <ListsTab />
        </TabsContent>
        <TabsContent value="landlords" className="mt-8">
          <LandlordsView embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
