"use client";

/**
 * /settings — account and plan.
 * Tab state lives in the URL (?tab=) so deep links like
 * /settings?tab=billing from the pull counter land on the right pane.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/primitives/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BillingTab } from "./billing-tab";
import { ProfileTab } from "./profile-tab";

export type SettingsTab = "profile" | "billing";

export function SettingsScreen({ initialTab }: { initialTab: SettingsTab }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The URL is the single source of truth, so navigating to
  // /settings?tab=billing while already on /settings switches panes, and
  // browser back/forward walk the tab history.
  const raw = searchParams.get("tab");
  const tab: SettingsTab = raw === "billing" || raw === "profile" ? raw : initialTab;

  const handleTabChange = (value: string) => {
    router.replace(`/settings?tab=${value}`, { scroll: false });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
      <PageHeader
        title="Settings"
        description="Your account and your plan."
      />

      <Tabs value={tab} onValueChange={handleTabChange} className="mt-8">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-8">
          <ProfileTab />
        </TabsContent>
        <TabsContent value="billing" className="mt-8">
          <BillingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
