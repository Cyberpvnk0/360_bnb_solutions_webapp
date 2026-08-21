"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_INTERNAL, NAV_MAIN, NAV_SYSTEM, type NavItem } from "@/config/nav";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/primitives/status-chip";
import { cn } from "@/lib/utils";

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

/**
 * Sidebar nav body, shared by the fixed desktop rail and the mobile sheet.
 * Active item carries the thin gold left rule.
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { tier, openUpgrade } = useSession();

  return (
    <div className="flex h-full flex-col">
      <nav aria-label="Primary" className="mt-4 flex flex-col">
        {NAV_MAIN.map((item) => (
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
