"use client";

/**
 * /settings — account, plan, and notification preferences.
 * Tab state lives in the URL (?tab=) so deep links like
 * /settings?tab=billing from the pull counter land on the right pane.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/primitives/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BillingTab } from "./billing-tab";
import { NotificationsTab } from "./notifications-tab";
import { ProfileTab } from "./profile-tab";

export type SettingsTab = "profile" | "billing" | "notifications";

export function SettingsScreen({ initialTab }: { initialTab: SettingsTab }) {
  const router = useRouter();
  const [tab, setTab] = React.useState<SettingsTab>(initialTab);

  const handleTabChange = (value: string) => {
    const next = value as SettingsTab;
    setTab(next);
    router.replace(`/settings?tab=${next}`, { scroll: false });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      <PageHeader
        title="Settings"
        description="Your account, your plan, and what we send you."
      />

      <Tabs value={tab} onValueChange={handleTabChange} className="mt-6">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-6">
          <ProfileTab />
        </TabsContent>
        <TabsContent value="billing" className="mt-6">
          <BillingTab />
        </TabsContent>
        <TabsContent value="notifications" className="mt-6">
          <NotificationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
