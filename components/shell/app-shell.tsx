"use client";

import * as React from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { APP_NAME } from "@/config/app";
import { AddressSearch } from "./address-search";
import { PullCounter } from "./pull-counter";
import { SidebarNav, SidebarRail } from "./sidebar-nav";
import { useSession } from "@/components/providers/session-provider";
import { authConfigured } from "@/lib/supabase/config";
import { ThemeToggle, UserMenu } from "./user-menu";
import { Wordmark } from "./wordmark";
import { UpgradeModal } from "@/components/upgrade/upgrade-modal";

/**
 * Product chrome: fixed sidebar (sheet on mobile), top bar with the
 * persistent address search and pull counter. The upgrade modal mounts
 * here once so any screen can open it.
 */
/**
 * Skeletons that never resolve are the worst failure a page can have,
 * because they look like loading. The server already verified a session
 * for every page under this shell (proxy.ts), so if the browser then
 * cannot load the account, that is a fault to report with a way out —
 * not a page of grey bars.
 */
function AccountGate({ children }: { children: React.ReactNode }) {
  const { ready, user, bootError } = useSession();
  if (!ready || user) return <>{children}</>;
  // No auth at all is a deployment problem, not a session one, and the
  // fix is a variable, not a reload.
  const unconfigured = !authConfigured();
  return (
    <div className="mx-auto max-w-md px-4 py-16 md:px-10">
      <div className="rounded-sm border border-border bg-card p-6">
        <p className="text-sm font-semibold text-foreground">
          {unconfigured
            ? "Sign-in isn't configured on this deployment"
            : "Your account didn't load in this tab"}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {unconfigured
            ? "The browser has no Supabase URL or publishable key, so nobody can be signed in. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and redeploy."
            : "You are signed in, but the browser could not read the account. Reloading usually fixes it; signing in again always does."}
        </p>
        {bootError ? (
          <p className="mt-2 break-words text-xs text-muted-foreground">
            {bootError}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="outline">
              Sign in again
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function AppShell({
  children,
  isAdmin = false,
}: {
  children: React.ReactNode;
  /** Decided on the server from the staff list; shows the Admin link. */
  isAdmin?: boolean;
}) {
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  return (
    <div className="flex min-h-dvh">
      {/* Desktop icon rail */}
      <aside className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col border-r border-border bg-surface lg:flex print:hidden">
        <Link
          href="/deals"
          aria-label={`${APP_NAME} home`}
          className="flex h-16 shrink-0 items-center justify-center border-b border-border transition-opacity duration-150 hover:opacity-80"
        >
          <span
            aria-hidden
            className="block size-3 rotate-45 border border-gold bg-gold-fill/20"
          />
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarRail isAdmin={isAdmin} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur md:px-6 print:hidden">
          {/* Mobile nav */}
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Open navigation"
              >
                <Menu aria-hidden className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-surface p-0">
              <SheetHeader className="border-b border-border px-4 py-3">
                <SheetTitle asChild>
                  <div>
                    <Wordmark />
                    <span className="sr-only">{APP_NAME} navigation</span>
                  </div>
                </SheetTitle>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <SidebarNav
                  isAdmin={isAdmin}
                  onNavigate={() => setMobileNavOpen(false)}
                />
              </div>
            </SheetContent>
          </Sheet>

          <AddressSearch className="w-full max-w-sm" />

          <div className="ml-auto flex items-center gap-2">
            <PullCounter />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <main className="min-w-0 flex-1">
          <AccountGate>{children}</AccountGate>
        </main>
      </div>

      <UpgradeModal />
    </div>
  );
}
