import { redirect } from "next/navigation";

/** The landlord book lives under Saved now, beside the rental lists. */
export default function LandlordsPage() {
  redirect("/saved?tab=landlords");
}
