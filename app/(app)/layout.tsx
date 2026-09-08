import { AppShell } from "@/components/shell/app-shell";
import { isStaff } from "@/lib/auth/gate";
import { currentUser } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Whether to show the staff link, decided here where ADMIN_EMAILS is
  // readable. The admin page checks again for itself; this is display.
  const user = await currentUser();
  return <AppShell isAdmin={isStaff(user?.email)}>{children}</AppShell>;
}
