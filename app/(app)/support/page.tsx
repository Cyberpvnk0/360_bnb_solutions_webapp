import { Suspense } from "react";
import { isSupportStaff } from "@/lib/auth/gate";
import { currentUser } from "@/lib/supabase/server";
import { SupportScreen } from "@/components/support/support-screen";

export const metadata = { title: "Support" };

// Whether the scope switch is drawn depends on who is asking, so this
// page can never be a build-time artefact shared between them.
export const dynamic = "force-dynamic";

/**
 * Whether the scope switch exists at all is decided here, on the
 * server, from ADMIN_EMAILS. The API decides it again for itself on
 * every call — this is only what gets drawn, and a client that lied
 * about it would get its own tickets back regardless.
 */
export default async function SupportPage() {
  const user = await currentUser();
  const staff = isSupportStaff(user);
  return (
    // useSearchParams needs a boundary; the screen loads its own rows
    // anyway, so there is nothing worth showing beneath it.
    <Suspense fallback={null}>
      <SupportScreen staff={staff} />
    </Suspense>
  );
}
