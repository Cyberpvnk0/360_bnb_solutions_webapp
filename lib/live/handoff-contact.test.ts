/**
 * Who to call, across the handover from a card to the result.
 *
 * The result opens in its own tab, so the contact has to travel in the
 * URL or be read off the listing's page again — a billed scrape for an
 * answer the card already had. These pin the round trip, and the
 * suspicion the reader applies to what anyone could have typed.
 */

import { describe, expect, it } from "vitest";
import { readContactParams, writeContactParams } from "./handoff-contact";
import { analyzeHref } from "./analyze-href";
import type { ListingContact } from "@/lib/mock/types";

const CONTACT: ListingContact = {
  name: "Jane Doe",
  company: "Riverside Realty",
  phone: "(904) 555-0142",
  email: "jane@riverside.example",
  role: "Listing agent",
};

const BASE = {
  address: "1804 E Sitka St",
  lat: 27.99,
  lon: -82.44,
  bedrooms: 2,
  bathrooms: 1,
  propertyType: "house",
};

const paramsOf = (href: string) => new URL(href, "https://app.example").searchParams;
const getter = (p: URLSearchParams) => (k: string) => p.get(k) ?? undefined;
const from = (v: Record<string, string>) => readContactParams((k) => v[k]);

describe("who to call travels into the analysis", () => {
  it("rides the link out of a card and reads back as it was", () => {
    const p = paramsOf(analyzeHref({ ...BASE, contact: CONTACT }));
    expect(readContactParams(getter(p))).toEqual(CONTACT);
  });

  it("is left out when the row has none", () => {
    const p = paramsOf(analyzeHref(BASE));
    for (const k of ["cn", "cc", "cp", "ce", "cr"]) expect(p.has(k)).toBe(false);
    expect(readContactParams(getter(p))).toBeUndefined();
    // A contact with nothing in it is none, not five empty fields.
    const q = new URLSearchParams();
    writeContactParams(q, { name: "  ", role: "Owner" });
    expect([...q.keys()]).toEqual([]);
  });

  it("keeps a number with no name, and a name with no number", () => {
    // Both are things listing pages routinely publish; neither gets a
    // field invented to fill the gap.
    const p = new URLSearchParams();
    writeContactParams(p, { phone: "904-555-0142", role: "Listing contact" });
    expect(readContactParams(getter(p))).toEqual({ phone: "904-555-0142", role: "Listing contact" });
    const q = new URLSearchParams();
    writeContactParams(q, { name: "Sam Owner", role: "Owner" });
    expect(readContactParams(getter(q))).toEqual({ name: "Sam Owner", role: "Owner" });
  });

  it("drops what is not a number, not an address, or not a role it knows", () => {
    // What comes out becomes a tel: and a mailto: link.
    expect(from({ cp: "call me", ce: "not-an-email", cr: "Scammer" })).toBeUndefined();
    expect(from({ cn: "Jane", cr: "Scammer" })).toEqual({ name: "Jane", role: "Listing contact" });
    expect(from({ cn: "x".repeat(81) })).toBeUndefined();
    expect(from({ cp: "555-0142" })).toEqual({ phone: "555-0142", role: "Listing contact" });
  });

  it("squeezes the whitespace a feed leaves in", () => {
    expect(from({ cn: "  Jane   Doe ", cr: "Property manager" })).toEqual({
      name: "Jane Doe",
      role: "Property manager",
    });
  });
});
