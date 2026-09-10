import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatPhone, lookupPhone, parseSkipTrace, phoneLookupConfigured, phonesIn } from "./phone-lookup";
import { readKeyedBlob, writeKeyed } from "@/lib/db/market-store";

vi.mock("@/lib/db/market-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/market-store")>()),
  readKeyedBlob: vi.fn(),
  writeKeyed: vi.fn(async () => ({ ok: true, detail: null })),
}));

/** A match, the way the vendor's docs write one: the numbers and
 *  emails beside the contact, the name inside it, the charge in cents. */
const HIT = {
  success: true,
  found: true,
  charged: 4,
  contact: {
    firstName: "Dana",
    lastName: "Lister",
    fullName: "Dana Lister",
    propertyAddress: "1804 E Sitka St",
    propertyCity: "Tampa",
    propertyState: "FL",
    propertyZip: "33604",
    mailingAddress: "PO Box 1",
    mailingCity: "Tampa",
    mailingState: "FL",
    mailingZip: "33601",
  },
  phones: [
    { number: "8135550142", type: "landline", dnc: false },
    { number: "+1 (813) 555-0199", type: "mobile", dnc: false },
    { number: "8135550199", type: "mobile" },
    { number: "555", type: "mobile" },
  ],
  emails: ["Dana@Example.com", { email: "dana@example.com" }, "not an email"],
};
const MISS = { success: true, found: false, contact: null, charged: 0 };

describe("reading the records vendor's answer", () => {
  it("takes the name, the numbers and the emails, the most useful number first", () => {
    const r = parseSkipTrace(HIT)!;
    expect(r.persons).toHaveLength(1);
    const [dana] = r.persons;
    expect(dana.name).toBe("Dana Lister");
    // The mobile first, the duplicate folded, the three-digit one dropped.
    expect(dana.phones.map((p) => p.number)).toEqual(["(813) 555-0199", "(813) 555-0142"]);
    expect(dana.phones[0]).toMatchObject({ type: "mobile", dnc: false });
    expect(dana.phones[1].type).toBe("landline");
    expect(dana.emails).toEqual(["dana@example.com"]);
    expect(phonesIn(r)).toBe(2);
  });

  it("reads the name off the contact and the numbers beside it as one person", () => {
    // The documented shape, and the same numbers nested inside the
    // contact instead: one person either way, never a nameless one
    // with the numbers and a named one with none.
    const documented = parseSkipTrace(HIT)!;
    expect(documented.persons).toHaveLength(1);
    expect(documented.persons[0].name).toBe("Dana Lister");
    const { phones, emails, ...rest } = HIT;
    const nested = parseSkipTrace({ ...rest, contact: { ...HIT.contact, phones, emails } })!;
    expect(nested).toEqual(documented);
    // A name from the parts when the full one is missing.
    const parts = parseSkipTrace({ found: true, contact: { firstName: "Dana", lastName: "Lister" }, phones: [{ number: "8135550142" }] })!;
    expect(parts.persons[0].name).toBe("Dana Lister");
  });

  it("reads a miss as nobody, and an unrecognisable answer as unreadable", () => {
    expect(parseSkipTrace(MISS)).toEqual({ persons: [] });
    expect(phonesIn(parseSkipTrace(MISS))).toBe(0);
    // A match with nobody usable in it is a no-match too.
    expect(parseSkipTrace({ success: true, found: true, contact: { fullName: "X Y" }, phones: [], emails: [] })).toEqual({
      persons: [],
    });
    // Nothing that reads as a contact, and no word on whether one was
    // found: a shape this does not know.
    expect(parseSkipTrace({ success: true })).toBeNull();
    expect(parseSkipTrace({ status: "queued", jobId: "j1" })).toBeNull();
    expect(parseSkipTrace(null)).toBeNull();
    expect(parseSkipTrace("nope")).toBeNull();
  });

  it("reads the contact wherever the answer puts it, and several of them", () => {
    const phone = [{ number: "8135550100", type: "mobile" }];
    expect(parseSkipTrace({ found: true, data: { contact: { name: "Under Data", phones: phone } } })!.persons[0].name).toBe(
      "Under Data"
    );
    expect(parseSkipTrace({ fullName: "At The Top", phones: phone })!.persons[0].name).toBe("At The Top");
    const two = parseSkipTrace({
      found: true,
      contacts: [
        { firstName: "One", lastName: "Owner", phones: phone },
        { name: { first: "Two", last: "Owner" }, phones: [{ phone: "8135550101", lineType: "wireless" }] },
      ],
    })!;
    expect(two.persons.map((p) => p.name)).toEqual(["One Owner", "Two Owner"]);
    expect(two.persons[1].phones[0]).toMatchObject({ number: "(813) 555-0101", type: "mobile" });
  });

  it("honours the flags: the deceased are dropped, do-not-call is marked on every number", () => {
    expect(
      parseSkipTrace({ found: true, contact: { fullName: "Late Owner", deceased: true, phones: [{ number: "8135550100" }] } })
    ).toEqual({ persons: [] });
    const r = parseSkipTrace({
      found: true,
      contact: { fullName: "Do Not Ring", dnc: true, phones: [{ number: "8135550100" }, { number: "8135550101", dnc: false }] },
    })!;
    expect(r.persons[0].phones.every((p) => p.dnc)).toBe(true);
    const one = parseSkipTrace({
      found: true,
      contact: { fullName: "One Flagged", phones: [{ number: "8135550100", dnc: true }, { number: "8135550101" }] },
    })!;
    expect(one.persons[0].phones.map((p) => p.dnc)).toEqual([true, false]);
  });

  it("formats ten digits the way a card reads them", () => {
    expect(formatPhone("8135550142")).toBe("(813) 555-0142");
  });
});

describe("asking the vendor", () => {
  const PLACE = { address: "1804 E Sitka St", city: "Tampa", stateCode: "FL", zip: "33604" };
  const read = vi.mocked(readKeyedBlob);
  const write = vi.mocked(writeKeyed);
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DATA_SKIP_API", "pc_test_key");
    vi.stubEnv("DATA_SKIP_API_URL", "");
    read.mockResolvedValue(null);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  const answer = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("is configured by the key under whichever name Vercel holds it", () => {
    expect(phoneLookupConfigured()).toBe(true);
    vi.stubEnv("DATA_SKIP_API", "");
    expect(phoneLookupConfigured()).toBe(false);
    vi.stubEnv("DataSkip_Key", "pc_named_so");
    expect(phoneLookupConfigured()).toBe(true);
    vi.stubEnv("DataSkip_Key", "");
    vi.stubEnv("dataskip_api_key", "any casing");
    expect(phoneLookupConfigured()).toBe(true);
    vi.stubEnv("dataskip_api_key", "");
    // The vendor's own variable name works too.
    vi.stubEnv("SKIPTRACE_API_KEY", "pc_theirs");
    expect(phoneLookupConfigured()).toBe(true);
    vi.stubEnv("SKIPTRACE_API_KEY", "");
    // The endpoint override is not mistaken for the key.
    vi.stubEnv("DATA_SKIP_API_URL", "https://example.test/trace");
    expect(phoneLookupConfigured()).toBe(false);
  });

  it("sends the key saved as DataSkip_Key", async () => {
    vi.stubEnv("DATA_SKIP_API", "");
    vi.stubEnv("DataSkip_Key", "pc_from_vercel");
    fetchMock.mockResolvedValue(answer(200, MISS));
    await lookupPhone(PLACE);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer pc_from_vercel");
  });

  it("posts the street line with the key, and stores a match for a month", async () => {
    fetchMock.mockResolvedValue(answer(200, HIT));
    const out = await lookupPhone({ ...PLACE, address: "1804 E Sitka St, Tampa, FL 33604" });
    expect(out).toMatchObject({ ok: true, from: "vendor" });
    expect(phonesIn(out.ok ? out.result : null)).toBe(2);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://app.dataskip.io/api/v1/skip-trace");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer pc_test_key");
    expect(JSON.parse(String(init.body))).toEqual({
      address: "1804 E Sitka St",
      city: "Tampa",
      state: "FL",
      zip: "33604",
    });
    expect(write).toHaveBeenCalledWith("phone:v1:fl:1804 sitka st e", expect.objectContaining({ result: expect.anything() }));
  });

  it("stores a miss as a miss, and answers from the store next time", async () => {
    fetchMock.mockResolvedValue(answer(200, MISS));
    expect(await lookupPhone(PLACE)).toEqual({ ok: true, result: null, from: "vendor" });
    expect(write).toHaveBeenCalledWith("phone:v1:fl:1804 sitka st e", { result: null });

    read.mockResolvedValue({ value: { result: null }, at: new Date().toISOString() });
    fetchMock.mockClear();
    expect(await lookupPhone(PLACE)).toEqual({ ok: true, result: null, from: "store" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says what went wrong, in the vendor's words when it gave any", async () => {
    fetchMock.mockResolvedValue(answer(401, { error: "invalid api key" }));
    expect(await lookupPhone(PLACE)).toMatchObject({ ok: false, reason: "auth", status: 401 });
    fetchMock.mockResolvedValue(answer(402, { error: "Insufficient balance", balanceRequired: 4 }));
    expect(await lookupPhone(PLACE)).toMatchObject({ ok: false, reason: "quota", status: 402 });
    fetchMock.mockResolvedValue(new Response("", { status: 429, headers: { "retry-after": "5" } }));
    expect(await lookupPhone(PLACE)).toMatchObject({ ok: false, reason: "quota", status: 429 });
    fetchMock.mockResolvedValue(answer(200, { success: false, error: "address could not be parsed" }));
    expect(await lookupPhone(PLACE)).toMatchObject({ ok: false, reason: "http", detail: "address could not be parsed" });
    fetchMock.mockResolvedValue(answer(200, { status: "queued", jobId: "j1" }));
    expect(await lookupPhone(PLACE)).toMatchObject({ ok: false, reason: "unreadable" });
    vi.stubEnv("DATA_SKIP_API", "");
    expect(await lookupPhone(PLACE)).toEqual({ ok: false, reason: "no-key" });
  });

  it("uses the endpoint override when one is set", async () => {
    vi.stubEnv("DATA_SKIP_API_URL", "https://example.test/trace");
    fetchMock.mockResolvedValue(answer(200, MISS));
    await lookupPhone(PLACE);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/trace");
  });
});
