import { describe, expect, it } from "vitest";
import { adminEmails, isStaff } from "./gate";

describe("the staff list", () => {
  it("reads a comma-separated allowlist, forgiving case and spaces", () => {
    const env = " Alex@Example.com, staff2@example.com ,,";
    expect(adminEmails(env)).toEqual(new Set(["alex@example.com", "staff2@example.com"]));
    expect(isStaff("ALEX@example.com", env)).toBe(true);
    expect(isStaff("staff2@example.com ", env)).toBe(true);
    expect(isStaff("someone-else@example.com", env)).toBe(false);
  });

  it("treats no list as no line: every signed-in account is staff", () => {
    // The beta: nobody has to be added anywhere to see the whole app.
    // An empty string here, never `undefined` — that would fall through
    // to the default parameter and read the machine's real ADMIN_EMAILS.
    expect(isStaff("anyone@example.com", "")).toBe(true);
    expect(isStaff("anyone@example.com", " , ,")).toBe(true);
  });

  it("never counts a signed-out visitor as staff, list or no list", () => {
    expect(isStaff(null, "")).toBe(false);
    expect(isStaff(undefined, "")).toBe(false);
    expect(isStaff("", "a@b.c")).toBe(false);
  });
});
