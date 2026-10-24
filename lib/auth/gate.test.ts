import { afterEach, describe, expect, it, vi } from "vitest";
import { adminEmails, isCodeAdmin, isStaff, isStaffUser, isSupportStaff } from "./gate";

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

describe("support staff, which is not the same list applied the same way", () => {
  const confirmed = (email: string) => ({ email, email_confirmed_at: "2026-01-01T00:00:00Z" });

  it("opens the queue to a named, confirmed address", () => {
    const env = "alex@example.com, sam@example.com";
    expect(isSupportStaff(confirmed("ALEX@example.com"), env)).toBe(true);
    expect(isSupportStaff(confirmed("sam@example.com "), env)).toBe(true);
  });

  it("FAILS CLOSED where isStaff opens: no list means nobody", () => {
    // This is the whole point of the second function. isStaff treats an
    // empty list as "the beta, everyone is on the inside" — right for a
    // page of totals, catastrophic for an inbox of other people's
    // private correspondence. Deployed without ADMIN_EMAILS, every
    // ticket is visible to its author and to no one else.
    expect(isStaff("anyone@example.com", "")).toBe(true);
    expect(isSupportStaff(confirmed("anyone@example.com"), "")).toBe(false);
    expect(isSupportStaff(confirmed("anyone@example.com"), " , ,")).toBe(false);
  });

  it("will not take an unconfirmed address, even a named one", () => {
    const env = "alex@example.com";
    expect(isSupportStaff({ email: "alex@example.com", email_confirmed_at: null }, env)).toBe(
      false
    );
    expect(isSupportStaff({ email: "alex@example.com" }, env)).toBe(false);
  });

  it("never counts a signed-out visitor", () => {
    expect(isSupportStaff(null, "alex@example.com")).toBe(false);
    expect(isSupportStaff(undefined, "alex@example.com")).toBe(false);
  });

  it("does not admit an address that merely resembles one on the list", () => {
    const env = "alex@example.com";
    expect(isSupportStaff(confirmed("alex@example.com.evil.test"), env)).toBe(false);
    expect(isSupportStaff(confirmed("xalex@example.com"), env)).toBe(false);
  });
});

describe("the access-code admin account", () => {
  const codeAdmin = { email: "owner+counsel@example.com", email_confirmed_at: null, app_metadata: { aircore_role: "admin" } };
  const member = { email: "someone@example.com", email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: { provider: "email" } };

  afterEach(() => vi.unstubAllEnvs());

  it("is an admin by its server-written flag, without being on the list", () => {
    expect(isCodeAdmin(codeAdmin)).toBe(true);
    expect(isSupportStaff(codeAdmin, "boss@example.com")).toBe(true);
    // ...and even where no list is set, the case where everyone else is shut out.
    expect(isSupportStaff(codeAdmin, "")).toBe(true);
    expect(isStaffUser(codeAdmin)).toBe(true);
  });

  it("takes nothing from a flag a member could set on themselves", () => {
    // user_metadata is the member's own to write; only app_metadata counts.
    const forged = { ...member, user_metadata: { aircore_role: "admin" } };
    expect(isCodeAdmin(forged)).toBe(false);
    expect(isSupportStaff(forged, "boss@example.com")).toBe(false);
    expect(isCodeAdmin({ ...member, app_metadata: { aircore_role: "Admin" } })).toBe(false);
    expect(isCodeAdmin(null)).toBe(false);
  });

  it("loses admin the moment code sign-in is switched off", () => {
    vi.stubEnv("ACCESS_CODE_LOGIN", "off");
    expect(isCodeAdmin(codeAdmin)).toBe(false);
    expect(isSupportStaff(codeAdmin, "")).toBe(false);
    // What is left is whatever its email alone would earn.
    expect(isStaffUser(codeAdmin)).toBe(isStaff(codeAdmin.email));
  });
});
