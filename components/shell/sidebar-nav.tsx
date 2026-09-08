"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_INTERNAL, NAV_MAIN, NAV_SYSTEM, type NavItem } from "@/config/nav";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/primitives/status-chip";
import { cn } from "@/lib/utils";

const MAIN_ITEMS: NavItem[] = NAV_MAIN;

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
          ? "bg-select font-medium text-white"
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
            ? "border-select bg-select text-white shadow-[0_1px_3px_rgba(0,0,0,0.25)]"
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
 * The active item is a solid red tile with a white icon — the pins' red,
 * filled, not tinted — plus the thin red left rule.
 */
export function SidebarRail({ isAdmin = false }: { isAdmin?: boolean }) {
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

      {/* Staff only. The page 404s for everyone else; the link should
          not advertise it. Decided on the server, from ADMIN_EMAILS. */}
      {isAdmin ? (
        <>
          <div aria-hidden className="mx-4 my-3 border-t border-border" />
          {NAV_INTERNAL.map((item) => (
            <RailLink key={item.href} item={item} pathname={pathname} />
          ))}
        </>
      ) : null}

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
 * Active item is a solid red row with white type.
 */
export function SidebarNav({
  onNavigate,
  isAdmin = false,
}: {
  onNavigate?: () => void;
  isAdmin?: boolean;
}) {
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

      {isAdmin ? (
        <div className="mt-8">
          <p className="metric-label px-5 pb-2">Staff</p>
          {NAV_INTERNAL.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
          ))}
        </div>
      ) : null}

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
