import { describe, expect, it } from "vitest";
import { alertEmail } from "./email";
import type { RentalListing } from "@/lib/mock/types";

const l = (id: string, address: string): RentalListing => ({
  id,
  analysisId: `r--${id}`,
  address,
  city: "Jacksonville",
  stateCode: "FL",
  marketSlug: "jacksonville",
  lat: 30.33,
  lon: -81.66,
  bedrooms: 2,
  bathrooms: 1,
  sqft: 900,
  propertyType: "house",
  rentMonthly: 1450,
  petFriendly: false,
  features: ["Furnished"],
  featuresKnown: true,
});

describe("the alert's mail", () => {
  it("names the count and the area, lists each rental with its facts, and escapes what it prints", () => {
    const mail = alertEmail({ label: "Jacksonville, FL" }, [l("1", "12 Oak St"), l("2", "<b>9 Elm</b> & Co")], "https://app.example/", "/deals?market=jacksonville");
    expect(mail.subject).toBe("2 new rentals in Jacksonville, FL match your alert");
    expect(mail.html).toContain("12 Oak St");
    expect(mail.html).toContain("&lt;b&gt;9 Elm&lt;/b&gt; &amp; Co");
    expect(mail.html).not.toContain("<b>9 Elm</b>");
    expect(mail.html).toContain("$1,450/mo · 2 bd / 1 ba · 900 sqft · Furnished");
    expect(mail.html).toContain('href="https://app.example/analyze/new?');
    expect(mail.html).toContain('href="https://app.example/deals?market=jacksonville"');
    expect(mail.text).toContain("12 Oak St, Jacksonville, FL — $1,450/mo");
    expect(mail.text).toContain("https://app.example/deals?market=jacksonville");
  });

  it("speaks in the singular for one", () => {
    expect(alertEmail({ label: "ZIP 33604" }, [l("1", "1 A St")], "https://app.example", "/deals?zip=33604").subject).toBe(
      "1 new rental in ZIP 33604 matches your alert"
    );
  });
});
