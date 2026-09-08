import { redirect } from "next/navigation";

/**
 * There is no dashboard. A fresh account has nothing to summarise, and
 * the work starts in the Deal Finder — so that is where every door
 * leads. The route stays so old links and bookmarks land somewhere.
 */
export default function DashboardPage() {
  redirect("/deals");
}
