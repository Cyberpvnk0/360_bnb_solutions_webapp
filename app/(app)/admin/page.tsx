import { notFound } from "next/navigation";
import { isAdminEmail } from "@/lib/auth/gate";
import { currentUser } from "@/lib/supabase/server";
import { AdminScreen } from "@/components/admin/admin-screen";

export const metadata = { title: "Admin" };

/**
 * Staff only. Everyone else gets the same 404 a page that never existed
 * would give — an operator surface should not announce itself with a
 * "you may not" that confirms it is there.
 */
export default async function AdminPage() {
  const user = await currentUser();
  if (!isAdminEmail(user?.email)) notFound();
  return <AdminScreen />;
}
