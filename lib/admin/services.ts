/**
 * Every outside service AirCore depends on, in one list.
 *
 * STAFF-ONLY DATA. This names vendors, which customer-facing copy never
 * does; it is read by the admin health route and nothing a member can
 * reach. It is also PURE DATA, with no imports, because the fetch
 * observer in instrumentation.ts loads it at server start and must not
 * drag every vendor module into boot with it.
 *
 * WHAT "PROBE" MEANS, AND WHY MOST ARE NOT LIVE. A health check that
 * spends money is a health check somebody stops pressing. So a service
 * is probed live only where the vendor offers a call that bills
 * nothing — an account endpoint, a token check, a free metadata
 * lookup, a write to our own store. The paid feeds (rentals, short-let
 * data, owner lookups) are judged instead by what happened the last
 * time the product really called them, which the observer records.
 */

export type ServiceId =
  | "supabase"
  | "vercel"
  | "rentcast"
  | "airroi"
  | "scraperapi"
  | "dataskip"
  | "anthropic"
  | "google-maps"
  | "mapbox"
  | "maptiler"
  | "census"
  | "resend"
  | "webpush"
  | "public-web"
  | "payments";

export type ServiceCategory = "infrastructure" | "data" | "ai" | "maps" | "messaging" | "billing";

/**
 * How the health route learns whether a service works.
 *
 *   live     a free call is made on every check
 *   passive  the last real calls the product made, as the observer saw them
 *   self     the route answering is the proof (the host it runs on)
 *   config   nothing to call; only whether it is set up
 */
export type ProbeKind = "live" | "passive" | "self" | "config";

export interface DashboardLink {
  label: string;
  url: string;
}

export interface ServiceSpec {
  id: ServiceId;
  /** The vendor, as its own dashboard names it. */
  name: string;
  category: ServiceCategory;
  /** What it does inside AirCore, in a line. */
  purpose: string;
  /** Where in the product a member would notice it failing. */
  usedBy: string[];
  /** How it bills, so a failing service can be weighed against cost. */
  billing: string;
  /**
   * Environment variables, for display. `A|B` lists spellings the
   * module accepts for one setting; a trailing `?` marks an optional
   * one. Whether the SERVICE counts as configured is decided by each
   * vendor module's own check, not by this list. Only presence is ever
   * reported — values never leave the server.
   */
  env: string[];
  /** Hostnames the fetch observer attributes to this service. */
  hosts: string[];
  dashboards: DashboardLink[];
  probe: ProbeKind;
  /** A core flow stops when this is down, rather than degrading. */
  critical: boolean;
  /** Said once, beside the status, where the row would mislead without it. */
  note?: string;
}

export const SERVICES: readonly ServiceSpec[] = [
  {
    id: "supabase",
    name: "Supabase",
    category: "infrastructure",
    purpose: "Database, member sign-in, plan meters and the shared cache every search reads first.",
    usedBy: ["Sign-in", "Credits and plans", "Saved lists", "Support tickets", "Every cached search"],
    billing: "Flat monthly plan",
    env: [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_URL",
      "SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY",
    ],
    hosts: [],
    dashboards: [{ label: "Projects", url: "https://supabase.com/dashboard/projects" }],
    probe: "live",
    critical: true,
  },
  {
    id: "vercel",
    name: "Vercel",
    category: "infrastructure",
    purpose: "Hosts the application and runs every server route, plus the daily alert schedule.",
    usedBy: ["The whole application"],
    billing: "Flat monthly plan, plus usage above it",
    env: [],
    hosts: [],
    dashboards: [{ label: "Dashboard", url: "https://vercel.com/dashboard" }],
    probe: "self",
    critical: true,
  },
  {
    id: "rentcast",
    name: "RentCast",
    category: "data",
    purpose: "Long-term rental listings: the Deal Finder's inventory in every market.",
    usedBy: ["Deal Finder", "Listing alerts"],
    billing: "Per request beyond the plan's monthly allowance",
    env: ["RENTCAST_API_KEY"],
    hosts: ["api.rentcast.io"],
    dashboards: [{ label: "API dashboard", url: "https://app.rentcast.io/app/api" }],
    probe: "passive",
    critical: true,
    note: "Not probed live: every call counts against the monthly request allowance.",
  },
  {
    id: "airroi",
    name: "AirROI",
    category: "data",
    purpose: "Short-term rental performance: comparables, nightly rates, occupancy, market history and pacing.",
    usedBy: ["Property analysis", "Market analysis", "Airbnb comps"],
    billing: "Per call, $0.01–$1.00 by endpoint, from a prepaid balance",
    env: ["AIRROI_API_KEY"],
    hosts: ["api.airroi.com"],
    dashboards: [{ label: "Account", url: "https://www.airroi.com/" }],
    probe: "passive",
    critical: true,
    note: "Not probed live: every call is billed. A disabled key or an empty balance shows here as the last call's refusal.",
  },
  {
    id: "scraperapi",
    name: "ScraperAPI",
    category: "data",
    purpose: "Reads public listing pages on our behalf: the furnished-rental search, landlord contact numbers, furnished flags.",
    usedBy: ["Furnished filter", "Landlord phone numbers", "Listing features"],
    billing: "Monthly credit allowance; protected pages cost 10–20 credits each",
    env: ["SCRAPERAPI_KEY"],
    hosts: ["api.scraperapi.com"],
    dashboards: [{ label: "Dashboard", url: "https://dashboard.scraperapi.com/" }],
    probe: "live",
    critical: true,
    note: "The account check is free. A target site failing a read returns 500 here without the vendor itself being down.",
  },
  {
    id: "dataskip",
    name: "DataSkip",
    category: "data",
    purpose: "Owner phone lookup from public records, offered when a listing carries no number.",
    usedBy: ["Deep phone lookup"],
    billing: "Per match; a search that finds nothing is free",
    env: ["DataSkip_Key|DATA_SKIP_API|DATASKIP_API_KEY|SKIPTRACE_API_KEY"],
    hosts: ["app.dataskip.io"],
    dashboards: [{ label: "Dashboard", url: "https://app.dataskip.io/" }],
    probe: "passive",
    critical: false,
    note: "Not probed live: a lookup with a real address may be billed.",
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    category: "ai",
    purpose: "The language model behind the in-product research assistant.",
    usedBy: ["AI Assistant"],
    billing: "Per token, from a prepaid balance",
    env: ["ANTHROPIC_API_KEY", "ANTHROPIC_WORKSPACE_ID?"],
    hosts: ["api.anthropic.com"],
    dashboards: [{ label: "Console", url: "https://platform.claude.com/" }],
    probe: "live",
    critical: false,
    note: "The key check is free but cannot see the prepaid balance; an empty balance shows as the assistant's last call failing.",
  },
  {
    id: "google-maps",
    name: "Google Maps Platform",
    category: "maps",
    purpose: "Street View photos of each property, address geocoding and address autocomplete.",
    usedBy: ["Property photos", "Map pins", "Address search"],
    billing: "Per request after a monthly credit; the Street View metadata check is free",
    env: ["GOOGLE_MAPS_API_KEY|GOOGLE_MAPS_SECRET|GOOGLE_MAPS_KEY|GOOGLE_API_KEY"],
    hosts: ["maps.googleapis.com", "places.googleapis.com"],
    dashboards: [
      { label: "Maps console", url: "https://console.cloud.google.com/google/maps-apis/overview" },
      { label: "Billing", url: "https://console.cloud.google.com/billing" },
    ],
    probe: "live",
    critical: false,
  },
  {
    id: "mapbox",
    name: "Mapbox",
    category: "maps",
    purpose: "Aerial photos where Street View has no coverage, and address suggestions.",
    usedBy: ["Property photos", "Address search"],
    billing: "Free tier, then per request",
    env: ["MAPBOX_TOKEN|MAPBOX_ACCESS_TOKEN|MAPBOX_KEY|NEXT_PUBLIC_MAPBOX_TOKEN"],
    hosts: ["api.mapbox.com"],
    dashboards: [{ label: "Account", url: "https://account.mapbox.com/" }],
    probe: "live",
    critical: false,
  },
  {
    id: "maptiler",
    name: "MapTiler",
    category: "maps",
    purpose: "The map tiles and styles on every map in the product.",
    usedBy: ["Deal Finder map", "Market maps"],
    billing: "Flat monthly plan",
    env: ["MAPTILER_KEY|NEXT_MAPTILER_KEY|NEXT_PUBLIC_MAPTILER_KEY"],
    hosts: ["api.maptiler.com"],
    dashboards: [{ label: "Cloud", url: "https://cloud.maptiler.com/" }],
    probe: "live",
    critical: false,
    note: "Without a key the maps fall back to OpenFreeMap tiles and keep working.",
  },
  {
    id: "census",
    name: "US Census Geocoder",
    category: "maps",
    purpose: "Free federal geocoder: the fallback when Google misses, and address typeahead.",
    usedBy: ["Map pins", "Address search"],
    billing: "Free, no key",
    env: [],
    hosts: ["geocoding.geo.census.gov"],
    dashboards: [{ label: "Service", url: "https://geocoding.geo.census.gov/geocoder/" }],
    probe: "live",
    critical: false,
  },
  {
    id: "resend",
    name: "Resend",
    category: "messaging",
    purpose: "Sends the new-listing alert emails.",
    usedBy: ["Email alerts"],
    billing: "Free tier, then stepped by monthly volume",
    env: ["RESEND_API_KEY", "ALERTS_FROM"],
    hosts: ["api.resend.com"],
    dashboards: [
      { label: "Emails", url: "https://resend.com/emails" },
      { label: "API keys", url: "https://resend.com/api-keys" },
    ],
    probe: "live",
    critical: false,
  },
  {
    id: "webpush",
    name: "Web Push",
    category: "messaging",
    purpose: "Push notifications for new listings, delivered through each browser's own push service.",
    usedBy: ["Push alerts"],
    billing: "Free",
    env: ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"],
    hosts: [],
    dashboards: [],
    probe: "config",
    critical: false,
    note: "Delivered by the browsers' push services, so there is no account to check — only whether the keys are set.",
  },
  {
    id: "public-web",
    name: "Public search engines",
    category: "data",
    purpose: "Finds a property's own listing page by searching its address, as a person would. No key, no account.",
    usedBy: ["Open listing", "Landlord contact"],
    billing: "Free",
    env: [],
    hosts: ["www.bing.com", "html.duckduckgo.com", "www.zillow.com"],
    dashboards: [],
    probe: "passive",
    critical: false,
  },
  {
    id: "payments",
    name: "Payments",
    category: "billing",
    purpose: "Plan checkout and credit-pack purchases.",
    usedBy: ["Upgrades", "Credit packs"],
    billing: "Per transaction",
    env: ["MOCK_CHECKOUT?"],
    hosts: [],
    dashboards: [],
    probe: "config",
    critical: false,
    note: "No payment processor is wired into the code yet. Plans are assigned from this panel; checkout answers that it is not live.",
  },
];

export const SERVICE_BY_ID: Readonly<Record<ServiceId, ServiceSpec>> = Object.fromEntries(
  SERVICES.map((s) => [s.id, s])
) as Record<ServiceId, ServiceSpec>;

/** Host → service, for the fetch observer. Exact hostnames only. */
const BY_HOST: ReadonlyMap<string, ServiceId> = new Map(
  SERVICES.flatMap((s) => s.hosts.map((h) => [h, s.id] as const))
);

/** Which service a request URL belongs to, or null for anything else —
 *  our own store, our own routes, and every host not listed above. */
export function serviceForUrl(url: string): ServiceId | null {
  try {
    return BY_HOST.get(new URL(url).hostname.toLowerCase()) ?? null;
  } catch {
    return null;
  }
}

/**
 * The project's own page in the Supabase dashboard, from its URL.
 *
 * The project ref is the subdomain of `<ref>.supabase.co`. Anything
 * that is not that shape — a custom domain, a local stack — gets the
 * projects list instead of a guessed link.
 */
export function supabaseProjectUrl(apiUrl: string | undefined): string | null {
  if (!apiUrl) return null;
  try {
    const host = new URL(apiUrl).hostname;
    const m = /^([a-z0-9]{15,40})\.supabase\.co$/i.exec(host);
    return m ? `https://supabase.com/dashboard/project/${m[1].toLowerCase()}` : null;
  } catch {
    return null;
  }
}
