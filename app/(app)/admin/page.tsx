import { notFound } from "next/navigation";
import { isStaffUser, isSupportStaff } from "@/lib/auth/gate";
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
  if (!isStaffUser(user)) notFound();
  // System health names this deployment's keys and vendors, so it is
  // for NAMED admins only — the fail-closed rule, not the staff one.
  return <AdminScreen healthAccess={isSupportStaff(user)} />;
}
