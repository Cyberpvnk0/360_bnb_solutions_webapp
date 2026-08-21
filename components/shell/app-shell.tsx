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
import { ThemeToggle, UserMenu } from "./user-menu";
import { Wordmark } from "./wordmark";
import { UpgradeModal } from "@/components/upgrade/upgrade-modal";

/**
 * Product chrome: fixed sidebar (sheet on mobile), top bar with the
 * persistent address search and pull counter. The upgrade modal mounts
 * here once so any screen can open it.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  return (
    <div className="flex min-h-dvh">
      {/* Desktop icon rail */}
      <aside className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <Link
          href="/dashboard"
          aria-label={`${APP_NAME} home`}
          className="flex h-16 shrink-0 items-center justify-center border-b border-border transition-opacity duration-150 hover:opacity-80"
        >
          <span
            aria-hidden
            className="block size-3 rotate-45 border border-gold bg-gold-fill/20"
          />
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarRail />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur md:px-6">
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
                <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
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

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <UpgradeModal />
    </div>
  );
}
