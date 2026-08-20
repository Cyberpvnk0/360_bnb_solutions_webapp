/**
 * 40 private landlord contacts.
 *
 * This list is per-user and never shared — no community data, no
 * verified-by counts, nothing aggregated across accounts.
 *
 * The first 18 landlords are linked to the 25 pipeline deals (some control
 * multiple buildings, so they carry more than one deal). Linking is
 * two-way: Deal.landlordIds is populated here.
 */

import { DEALS } from "./deals";
import { daysAgo, Rng } from "./seed";
import type { Landlord, StrPolicy } from "./types";

const FIRST = [
  "Marcus", "Diane", "Raymond", "Priya", "Tom", "Angela", "Victor", "Susan",
  "Hank", "Gloria", "Dale", "Renee", "Walter", "Carmen", "Doug", "Elaine",
  "Roy", "Nadia", "Frank", "Teresa", "Gene", "Paula", "Omar", "Judith",
  "Neil", "Rosa", "Chuck", "Yolanda", "Stan", "Marta", "Earl", "Vivian",
  "Pete", "Lorraine", "Sal", "Bonnie", "Ivan", "Cheryl", "Gus", "Dora",
];
const LAST = [
  "Whitfield", "Okafor", "Brennan", "Castillo", "Hargrove", "Lindqvist",
  "Patel", "McAllister", "Duarte", "Kovacs", "Ferrell", "Nakamura",
  "Boone", "Salazar", "Trask", "Ellison", "Vance", "Herrera", "Quimby",
  "Ashford", "Delgado", "Munson", "Ybarra", "Crockett", "Stein", "Palmer",
  "Rooney", "Vega", "Holt", "Barrera", "Kessler", "Odom", "Prentice",
  "Solano", "Whitaker", "Nunez", "Grady", "Iverson", "Landry", "Beck",
];

const COMPANY_SUFFIX = [
  "Properties", "Property Group", "Realty", "Holdings", "Rentals",
  "Investments", "Residential", "Asset Management",
];

const NOTES = [
  "Prefers text over email. Slow to respond on Fridays.",
  "Owns the whole fourplex; open to master lease on all units.",
  "Burned by a party house before — lead with insurance and noise monitoring.",
  "Wants 12 months of rent history from my other units first.",
  "Referred by the property manager on Cedar Ridge.",
  "Asked for a walkthrough video of my current listing. Sent 6/2.",
  "Retiring next year; may sell the portfolio. Stay close.",
  "Will only do month 1 + deposit up front, no extra escrow.",
  "Son handles the leasing paperwork; loop him on everything.",
  "Met at the REIA meetup. Follow up quarterly.",
  "",
  "",
];

const EMAIL_DOMAINS = ["gmail.com", "outlook.com", "yahoo.com", "aol.com"];
const AREA_CODES = [407, 813, 615, 480, 614, 512, 210, 305, 702, 423, 901, 216];

/** yes 35%, negotiable 40%, no 25% */
function policyFor(rng: Rng): StrPolicy {
  const r = rng.float(0, 1);
  if (r < 0.35) return "yes";
  if (r < 0.75) return "negotiable";
  return "no";
}

const rng = new Rng(0x1a4d);

// Deal assignment: landlords 0..17 carry the 25 deals; a few carry 2–3.
const dealAssignments: string[][] = Array.from({ length: 18 }, () => []);
DEALS.forEach((deal, i) => {
  dealAssignments[i % 18].push(deal.id);
});

export const LANDLORDS: Landlord[] = Array.from({ length: 40 }, (_, i) => {
  const first = FIRST[i];
  const last = LAST[i];
  const hasCompany = rng.chance(0.55);
  const dealIds = i < 18 ? dealAssignments[i] : [];
  const policy = dealIds.length > 0
    ? (rng.chance(0.6) ? "yes" : "negotiable") // people you're in deals with said yes-ish
    : policyFor(rng);

  return {
    id: `ll-${String(i + 1).padStart(2, "0")}`,
    name: `${first} ${last}`,
    company: hasCompany
      ? `${rng.chance(0.5) ? last : rng.pick(["Northgate", "Bayline", "Redstone", "Copper Hill", "Palm Court", "Summit", "Lakemont", "Ironbridge"])} ${rng.pick(COMPANY_SUFFIX)}`
      : undefined,
    phone: `(${rng.pick(AREA_CODES)}) ${rng.int(200, 989)}-${String(rng.int(0, 9999)).padStart(4, "0")}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@${rng.pick(EMAIL_DOMAINS)}`,
    unitsControlled: rng.chance(0.3) ? rng.int(12, 80) : rng.int(1, 11),
    allowsStr: policy,
    lastContacted: rng.chance(0.8) ? daysAgo(rng.int(0, 60)) : undefined,
    notes: rng.pick(NOTES),
    dealIds,
    createdAt: daysAgo(rng.int(10, 200)),
  };
});

// Two-way link: put landlord ids onto their deals.
LANDLORDS.forEach((landlord) => {
  landlord.dealIds.forEach((dealId) => {
    const deal = DEALS.find((d) => d.id === dealId);
    if (deal && !deal.landlordIds.includes(landlord.id)) {
      deal.landlordIds.push(landlord.id);
    }
  });
});

export const LANDLORD_BY_ID: Map<string, Landlord> = new Map(
  LANDLORDS.map((l) => [l.id, l])
);
