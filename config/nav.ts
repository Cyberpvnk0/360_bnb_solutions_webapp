import {
  Binoculars,
  Bookmark,
  Columns3,
  Crosshair,
  Globe2,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Highlight for nested routes too (e.g. /markets/austin). */
  match: (pathname: string) => boolean;
}

export const NAV_MAIN: NavItem[] = [
  // The Deal Finder is where the work starts, so it is the first door:
  // there is no dashboard to summarise an account that has done nothing
  // yet, and every sign-in lands here.
  {
    href: "/deals",
    label: "Deal Finder",
    icon: Binoculars,
    match: (p) => p.startsWith("/deals"),
  },
  // Where to look, before which property: the one question the Deal
  // Finder cannot answer, because a city's rule on nightly letting is
  // not a fact about any listing in it.
  {
    href: "/markets",
    label: "Markets",
    icon: Globe2,
    match: (p) => p.startsWith("/markets"),
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
  // Saved: the rental lists and the landlord book, under one roof.
  {
    href: "/saved",
    label: "Saved",
    icon: Bookmark,
    match: (p) => p.startsWith("/saved") || p.startsWith("/landlords"),
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
