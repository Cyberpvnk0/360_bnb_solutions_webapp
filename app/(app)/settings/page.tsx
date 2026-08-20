import { SettingsScreen, type SettingsTab } from "@/components/settings/settings-screen";

export const metadata = { title: "Settings" };

const TABS: SettingsTab[] = ["profile", "billing", "notifications"];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialTab: SettingsTab = TABS.includes(tab as SettingsTab)
    ? (tab as SettingsTab)
    : "profile";
  return <SettingsScreen initialTab={initialTab} />;
}
