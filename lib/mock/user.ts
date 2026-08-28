/**
 * The demo session: a Pro-tier operator mid-way through a billing period.
 * The tier can be switched at runtime (see SessionProvider) to preview the
 * free-tier upgrade path; these are just the starting values.
 */

import { TIERS } from "@/config/app";
import { ANALYSES } from "./analyses";
import { DEALS } from "./deals";
import { daysAgo } from "./seed";
import type { ActivityEvent, Invoice, SessionUser } from "./types";

export const SESSION_USER: SessionUser = {
  id: "u-demo",
  name: "Jordan Avery",
  email: "jordan@example.com",
  tier: "pro",
  pullsUsed: 37,
  periodEnd: "2026-09-05",
  joinedAt: "2026-02-14",
  watchedMarketSlugs: [
    "kissimmee",
    "san-antonio",
    "pigeon-forge",
    "scottsdale",
    "columbus",
  ],
  billingCycle: "monthly",
};

/** Amounts and names come from config/app so a price change there keeps
 *  the invoice history consistent with the plan card above it. */
export const INVOICES: Invoice[] = [
  { id: "inv-0008", date: "2026-08-05", description: `${TIERS.pro.name} — monthly`, amount: TIERS.pro.priceMonthly, status: "paid" },
  { id: "inv-0007", date: "2026-07-05", description: `${TIERS.pro.name} — monthly`, amount: TIERS.pro.priceMonthly, status: "paid" },
  { id: "inv-0006", date: "2026-06-05", description: `${TIERS.pro.name} — monthly`, amount: TIERS.pro.priceMonthly, status: "paid" },
  { id: "inv-0005", date: "2026-05-05", description: `${TIERS.pro.name} — monthly`, amount: TIERS.pro.priceMonthly, status: "paid" },
  { id: "inv-0004", date: "2026-04-05", description: `${TIERS.starter.name} — monthly`, amount: TIERS.starter.priceMonthly, status: "paid" },
  { id: "inv-0003", date: "2026-03-05", description: `${TIERS.starter.name} — monthly`, amount: TIERS.starter.priceMonthly, status: "paid" },
  { id: "inv-0002", date: "2026-02-14", description: `${TIERS.starter.name} — first month`, amount: TIERS.starter.priceMonthly, status: "paid" },
];

/** Recent activity, newest first. References real analyses and deals. */
export const ACTIVITY: ActivityEvent[] = [
  {
    id: "ev-01",
    type: "pull",
    message: `Pulled ${ANALYSES[27].address}, ${ANALYSES[27].city}, ${ANALYSES[27].stateCode}`,
    at: `${daysAgo(0)}T14:20:00Z`,
    href: `/analyze/${ANALYSES[27].id}`,
  },
  {
    id: "ev-02",
    type: "deal-stage",
    message: `${DEALS[14].address}, ${DEALS[14].city} moved to Landlord Approved`,
    at: `${daysAgo(0)}T09:45:00Z`,
    href: "/pipeline",
  },
  {
    id: "ev-03",
    type: "pull",
    message: `Pulled ${ANALYSES[28].address}, ${ANALYSES[28].city}, ${ANALYSES[28].stateCode}`,
    at: `${daysAgo(1)}T18:05:00Z`,
    href: `/analyze/${ANALYSES[28].id}`,
  },
  {
    id: "ev-04",
    type: "landlord-added",
    message: "Added landlord contact Diane Okafor",
    at: `${daysAgo(1)}T16:30:00Z`,
    href: "/landlords",
  },
  {
    id: "ev-05",
    type: "deal-saved",
    message: `Saved ${DEALS[2].address}, ${DEALS[2].city} to Prospecting`,
    at: `${daysAgo(2)}T11:15:00Z`,
    href: "/pipeline",
  },
  {
    id: "ev-06",
    type: "export",
    message: `Exported landlord packet for ${DEALS[20].address}, ${DEALS[20].city}`,
    at: `${daysAgo(2)}T10:02:00Z`,
  },
  {
    id: "ev-07",
    type: "pull",
    message: `Pulled ${ANALYSES[29].address}, ${ANALYSES[29].city}, ${ANALYSES[29].stateCode}`,
    at: `${daysAgo(3)}T20:40:00Z`,
    href: `/analyze/${ANALYSES[29].id}`,
  },
  {
    id: "ev-08",
    type: "market-watched",
    message: "Watching Columbus, OH",
    at: `${daysAgo(4)}T13:25:00Z`,
    href: "/deals?market=columbus",
  },
  {
    id: "ev-09",
    type: "deal-stage",
    message: `${DEALS[22].address}, ${DEALS[22].city} moved to Live`,
    at: `${daysAgo(5)}T08:50:00Z`,
    href: "/pipeline",
  },
  {
    id: "ev-10",
    type: "pull",
    message: `Pulled ${ANALYSES[26].address}, ${ANALYSES[26].city}, ${ANALYSES[26].stateCode}`,
    at: `${daysAgo(6)}T15:10:00Z`,
    href: `/analyze/${ANALYSES[26].id}`,
  },
  {
    id: "ev-11",
    type: "deal-stage",
    message: `${DEALS[18].address}, ${DEALS[18].city} moved to Leased`,
    at: `${daysAgo(7)}T17:35:00Z`,
    href: "/pipeline",
  },
  {
    id: "ev-12",
    type: "landlord-added",
    message: "Added landlord contact Victor Hargrove",
    at: `${daysAgo(8)}T12:00:00Z`,
    href: "/landlords",
  },
];
