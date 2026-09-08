import { describe, expect, it } from "vitest";
import { csvCell, csvFileName, toCsv } from "./csv";

describe("csv cells", () => {
  it("quotes only what needs quoting, and doubles inner quotes", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a, b")).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("never lets a cell open as a formula", () => {
    // Excel and Sheets execute these on open; a note someone typed must
    // not run as code on the exporter's machine.
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1 (904) 555-0100")).toBe("'+1 (904) 555-0100");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@handle")).toBe("'@handle");
    // Numbers stay numbers: the guard is about text that looks like code.
    expect(csvCell(-5)).toBe("-5");
  });

  it("writes blanks for nothing, and words for booleans", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(true)).toBe("Yes");
    expect(csvCell(false)).toBe("No");
  });
});

describe("csv files", () => {
  it("starts with a byte-order mark and ends every line with CRLF", () => {
    const csv = toCsv(
      [{ name: "Peña", n: 2 }],
      [
        { header: "Name", value: (r) => r.name },
        { header: "Units", value: (r) => r.n },
      ]
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe("Name,Units\r\nPeña,2\r\n");
  });

  it("exports exactly the declared columns, in order", () => {
    const csv = toCsv(
      [{ a: 1, b: 2, secret: "no" }],
      [
        { header: "B", value: (r) => r.b },
        { header: "A", value: (r) => r.a },
      ]
    );
    expect(csv).not.toContain("secret");
    expect(csv.slice(1)).toBe("B,A\r\n2,1\r\n");
  });

  it("names files safely and dates them", () => {
    expect(csvFileName("Landlords: Jax / FL", new Date("2026-09-08T12:00:00Z"))).toBe(
      "landlords-jax-fl-2026-09-08.csv"
    );
    expect(csvFileName("///", new Date("2026-09-08T12:00:00Z"))).toBe(
      "export-2026-09-08.csv"
    );
  });
});
