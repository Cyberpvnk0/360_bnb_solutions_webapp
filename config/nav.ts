import {Columns3,Contact,Crosshair,LayoutGrid,Settings,ShieldCheck,type LucideIcon} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Highlight for nested routes too (e.g. /markets/austin). */
  match: (pathname: string) => boolean;
}

export const NAV_MAIN: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutGrid,
    match: (p) => p.startsWith("/dashboard"),
  },
  {
    href: "/analyze",
    label: "Analyze",
    icon: Crosshair,
    match: (p) => p.startsWith("/analyze"),
  },
  {
    href: "/pipeline",
    label: "Pipeline",
    icon: Columns3,
    match: (p) => p.startsWith("/pipeline"),
  },
  {
    href: "/landlords",
    label: "Landlords",
    icon: Contact,
    match: (p) => p.startsWith("/landlords"),
  },
];

export const NAV_SYSTEM: NavItem[] = [
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    match: (p) => p.startsWith("/settings"),
  },
];

export const NAV_INTERNAL: NavItem[] = [
  {
    href: "/admin",
    label: "Admin",
    icon: ShieldCheck,
    match: (p) => p.startsWith("/admin"),
  },
];
