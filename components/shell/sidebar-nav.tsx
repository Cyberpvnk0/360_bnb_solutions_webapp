"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Binoculars } from "lucide-react";
import { NAV_INTERNAL, NAV_MAIN, NAV_SYSTEM, type NavItem } from "@/config/nav";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/primitives/status-chip";
import { cn } from "@/lib/utils";

/** Deal Finder ships with the /deals screen rather than config/nav.ts,
 *  so it is inserted here — second, right after the dashboard, now that
 *  it is the way into inventory rather than one option beside a market
 *  browser. */
const DEAL_FINDER: NavItem = {
  href: "/deals",
  label: "Deal Finder",
  icon: Binoculars,
  match: (p) => p.startsWith("/deals"),
};

const MAIN_ITEMS: NavItem[] = (() => {
  const items = NAV_MAIN.filter((i) => i.href !== DEAL_FINDER.href);
  return [items[0], DEAL_FINDER, ...items.slice(1)].filter(Boolean);
})();

function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = item.match(pathname);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 px-5 py-2.5 text-sm transition-colors duration-150",
        active
          ? "active-rule bg-secondary/60 font-medium text-foreground"
          : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
      )}
    >
      <Icon aria-hidden className="size-4" strokeWidth={1.75} />
      {item.label}
    </Link>
  );
}

function RailLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.match(pathname);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex w-full flex-col items-center gap-1.5 py-2.5 transition-colors duration-150",
        active && "active-rule"
      )}
    >
      <span
        className={cn(
          "flex size-9 items-center justify-center rounded-sm border transition-colors duration-150",
          active
            ? "border-gold-fill/40 bg-gold-fill/10 text-gold"
            : "border-transparent text-muted-foreground group-hover:bg-secondary/60 group-hover:text-foreground"
        )}
      >
        <Icon aria-hidden className="size-4" strokeWidth={1.75} />
      </span>
      <span
        className={cn(
          "px-1 text-center text-[10px] font-medium leading-none tracking-wide",
          active
            ? "text-foreground"
            : "text-muted-foreground group-hover:text-foreground"
        )}
      >
        {item.label}
      </span>
    </Link>
  );
}

/**
 * Desktop icon rail: icon tile with the page name beneath, stacked.
 * The active item carries the gold-washed tile and the thin gold left rule.
 */
export function SidebarRail() {
  const pathname = usePathname();
  const { tier, openUpgrade } = useSession();

  return (
    <div className="flex h-full flex-col">
      <nav aria-label="Primary" className="mt-3 flex flex-col">
        {MAIN_ITEMS.map((item) => (
          <RailLink key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>

      <div aria-hidden className="mx-4 my-3 border-t border-border" />
      {NAV_SYSTEM.map((item) => (
        <RailLink key={item.href} item={item} pathname={pathname} />
      ))}

      <div aria-hidden className="mx-4 my-3 border-t border-border" />
      {NAV_INTERNAL.map((item) => (
        <RailLink key={item.href} item={item} pathname={pathname} />
      ))}

      <div className="mt-auto flex flex-col items-center gap-2 border-t border-border p-3">
        <StatusChip tone={tier.id === "free" ? "neutral" : "gold"}>
          {tier.name}
        </StatusChip>
        {tier.id !== "scale" ? (
          <Button
            size="sm"
            className="h-7 w-full px-1 text-[11px]"
            onClick={() => openUpgrade({ reason: "generic" })}
          >
            Upgrade
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Full-width nav list used by the mobile sheet.
 * Active item carries the thin gold left rule.
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { tier, openUpgrade } = useSession();

  return (
    <div className="flex h-full flex-col">
      <nav aria-label="Primary" className="mt-4 flex flex-col">
        {MAIN_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="mt-8">
        <p className="metric-label px-5 pb-2">Account</p>
        {NAV_SYSTEM.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </div>

      <div className="mt-8">
        <p className="metric-label px-5 pb-2">Internal</p>
        {NAV_INTERNAL.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </div>

      <div className="mt-auto border-t border-border p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Current plan</span>
          <StatusChip tone={tier.id === "free" ? "neutral" : "gold"}>
            {tier.name}
          </StatusChip>
        </div>
        {tier.id !== "scale" ? (
          <Button
            size="sm"
            className="mt-3 w-full"
            onClick={() => {
              onNavigate?.();
              openUpgrade({ reason: "generic" });
            }}
          >
            Upgrade
          </Button>
        ) : null}
      </div>
    </div>
  );
}
