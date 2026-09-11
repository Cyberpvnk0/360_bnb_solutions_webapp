import { SavedScreen, type SavedTab } from "@/components/saved/saved-screen";

export const metadata = { title: "Saved" };

const TABS: SavedTab[] = ["lists", "markets", "landlords"];

export default async function SavedPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialTab: SavedTab = TABS.includes(tab as SavedTab)
    ? (tab as SavedTab)
    : "lists";
  return <SavedScreen initialTab={initialTab} />;
}
