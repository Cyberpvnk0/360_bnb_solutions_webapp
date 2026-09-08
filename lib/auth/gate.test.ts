import { describe, expect, it } from "vitest";
import { adminEmails, isAdminEmail } from "./gate";

describe("the staff list", () => {
  it("reads a comma-separated allowlist, forgiving case and spaces", () => {
    const env = " Alex@Example.com, staff2@example.com ,,";
    expect(adminEmails(env)).toEqual(new Set(["alex@example.com", "staff2@example.com"]));
    expect(isAdminEmail("ALEX@example.com", env)).toBe(true);
    expect(isAdminEmail("staff2@example.com ", env)).toBe(true);
  });

  it("admits nobody when the list is empty or missing", () => {
    // An empty allowlist must mean "no admins", never "everyone".
    expect(isAdminEmail("anyone@example.com", "")).toBe(false);
    expect(isAdminEmail("anyone@example.com", undefined)).toBe(false);
    expect(isAdminEmail(null, "a@b.c")).toBe(false);
  });
});
