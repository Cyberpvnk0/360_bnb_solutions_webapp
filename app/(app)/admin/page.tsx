import { notFound } from "next/navigation";
import { isStaff } from "@/lib/auth/gate";
import { currentUser } from "@/lib/supabase/server";
import { AdminScreen } from "@/components/admin/admin-screen";

export const metadata = { title: "Admin" };

/**
 * Staff only — which, with no ADMIN_EMAILS set, is every signed-in
 * account (see lib/auth/gate). Anyone the list excludes gets the same
 * 404 a page that never existed would give.
 */
export default async function AdminPage() {
  const user = await currentUser();
  if (!isStaff(user?.email)) notFound();
  return <AdminScreen />;
}
