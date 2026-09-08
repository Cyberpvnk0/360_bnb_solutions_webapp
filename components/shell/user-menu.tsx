"use client";

import Link from "next/link";
import { LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";
import { TIER_ORDER, TIERS } from "@/config/app";
import { useSession } from "@/components/providers/session-provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

const emptySubscribe = () => () => {};

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // True only after hydration, so the icon can't mismatch the server HTML.
  const mounted = React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle light or dark theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {mounted && resolvedTheme === "light" ? (
        <Sun aria-hidden className="size-4" />
      ) : (
        <Moon aria-hidden className="size-4" />
      )}
    </Button>
  );
}

export function UserMenu() {
  const { ready, user, tier, setTier } = useSession();
  // Sign-out is a POST to the route that clears the session server-side
  // and 303s to the sign-in page. A hidden form, submitted from the menu
  // item, so the browser follows the redirect as a real navigation.
  const signOutForm = React.useRef<HTMLFormElement>(null);

  if (!ready || !user) {
    return <Skeleton className="size-8 rounded-full" />;
  }

  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="rounded-full transition-opacity duration-150 hover:opacity-80"
        >
          <Avatar className="size-8 border border-border">
            <AvatarFallback className="bg-secondary text-xs font-medium text-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <div className="text-sm font-medium text-foreground">{user.name}</div>
          <div className="text-xs font-normal text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=billing">Billing &amp; plan</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <span>
              Demo: view as{" "}
              <span className="text-muted-foreground">{tier.name}</span>
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={tier.id}
              onValueChange={(v) => setTier(v as (typeof TIER_ORDER)[number])}
            >
              {TIER_ORDER.map((id) => (
                <DropdownMenuRadioItem key={id} value={id}>
                  {TIERS[id].name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        {/* "Log out" used to router.push("/") — a navigation, not a
            sign-out. The session cookie survived it, so every door led
            straight back to the dashboard and the sign-in and sign-up
            screens were unreachable from inside the app. */}
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            signOutForm.current?.requestSubmit();
          }}
        >
          <LogOut aria-hidden className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
      <form ref={signOutForm} action="/auth/signout" method="post" hidden />
    </DropdownMenu>
  );
}
