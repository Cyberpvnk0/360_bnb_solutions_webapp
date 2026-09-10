import { describe, expect, it } from "vitest";
import { formatPhone, parseSkipTrace, phonesIn } from "./phone-lookup";

const ANSWER = {
  status: { code: 200, text: "OK" },
  results: {
    persons: [
      {
        _id: "p1",
        name: { first: "Dana", last: "Lister" },
        phoneNumbers: [
          { number: "8135550142", type: "Land Line", tested: true, reachable: true, score: 90 },
          { number: "+1 (813) 555-0199", type: "Mobile", tested: true, reachable: true, score: 100 },
          { number: "8135550199", type: "Mobile" },
          { number: "555", type: "Mobile" },
        ],
        emails: [{ email: "Dana@Example.com" }, "dana@example.com", "not an email"],
        dnc: { dnc: false, tcpa: false },
      },
      {
        name: { full: "Late Owner" },
        phoneNumbers: [{ number: "8135550100" }],
        death: { deceased: true },
      },
      {
        name: "Do Not Ring",
        phones: [{ phone: "8135550111", lineType: "wireless", dnc: true }],
      },
      { name: "Nobody Reachable", phoneNumbers: [], emails: [] },
    ],
    meta: { results: { requestCount: 1, matchCount: 1 } },
  },
};

describe("reading the records vendor's answer", () => {
  it("takes names, numbers and emails, the most useful number first", () => {
    const r = parseSkipTrace(ANSWER)!;
    expect(r.persons).toHaveLength(2);
    const [dana, ring] = r.persons;
    expect(dana.name).toBe("Dana Lister");
    // The mobile that scored best first, the duplicate folded, the
    // three-digit one dropped.
    expect(dana.phones.map((p) => p.number)).toEqual(["(813) 555-0199", "(813) 555-0142"]);
    expect(dana.phones[0]).toMatchObject({ type: "mobile", dnc: false, reachable: true, score: 100 });
    expect(dana.phones[1].type).toBe("landline");
    expect(dana.emails).toEqual(["dana@example.com"]);
    expect(ring.name).toBe("Do Not Ring");
    expect(ring.phones[0]).toMatchObject({ number: "(813) 555-0111", type: "mobile", dnc: true });
    expect(phonesIn(r)).toBe(3);
  });

  it("drops the deceased and anyone with nothing to show", () => {
    const names = parseSkipTrace(ANSWER)!.persons.map((p) => p.name);
    expect(names).not.toContain("Late Owner");
    expect(names).not.toContain("Nobody Reachable");
  });

  it("marks every number of a person the records flag do-not-call", () => {
    const r = parseSkipTrace({
      persons: [{ name: "X Y", dnc: true, phoneNumbers: [{ number: "8135550100" }, { number: "8135550101" }] }],
    })!;
    expect(r.persons[0].phones.every((p) => p.dnc)).toBe(true);
  });

  it("calls an answer with nobody in it a no-match, and one with no persons unreadable", () => {
    expect(parseSkipTrace({ results: { persons: [] } })).toEqual({ persons: [] });
    expect(phonesIn(parseSkipTrace({ results: { persons: [] } }))).toBe(0);
    expect(parseSkipTrace({ status: { code: 200 }, results: {} })).toBeNull();
    expect(parseSkipTrace(null)).toBeNull();
    expect(parseSkipTrace("nope")).toBeNull();
  });

  it("formats ten digits the way a card reads them", () => {
    expect(formatPhone("8135550142")).toBe("(813) 555-0142");
  });
});
