import { describe, expect, it } from "vitest";
import { parseInline, parseMessage } from "./message-text";

describe("the assistant's words, parsed", () => {
  it("reads links, bold, code and bare URLs, and nothing else", () => {
    expect(parseInline("See [Zillow · 2262 Kingston St](https://www.zillow.com/x) and **$979/mo**.")).toEqual([
      { kind: "text", text: "See " },
      { kind: "link", text: "Zillow · 2262 Kingston St", href: "https://www.zillow.com/x" },
      { kind: "text", text: " and " },
      { kind: "bold", text: "$979/mo" },
      { kind: "text", text: "." },
    ]);
    expect(parseInline("Page: https://example.com/a/b?c=1.")).toEqual([
      { kind: "text", text: "Page: " },
      { kind: "link", text: "https://example.com/a/b?c=1", href: "https://example.com/a/b?c=1" },
      { kind: "text", text: "." },
    ]);
    // Only an http(s) target is a link; anything else is left as text.
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ kind: "text", text: "[x](javascript:alert(1))" }]);
    expect(parseInline("`code`")).toEqual([{ kind: "code", text: "code" }]);
  });

  it("groups paragraphs and lists, and flattens a heading into a line", () => {
    const blocks = parseMessage("## Found it\nTwo pages.\n\n- [A](https://a.example)\n- [B](https://b.example)\n\n1. first\n2. second");
    expect(blocks.map((b) => b.kind)).toEqual(["p", "list", "list"]);
    expect(blocks[0]).toEqual({
      kind: "p",
      lines: [[{ kind: "text", text: "Found it" }], [{ kind: "text", text: "Two pages." }]],
    });
    expect(blocks[1]).toMatchObject({ kind: "list", ordered: false });
    expect((blocks[1] as { items: unknown[] }).items).toHaveLength(2);
    expect(blocks[2]).toMatchObject({ kind: "list", ordered: true });
  });

  it("renders nothing for nothing", () => {
    expect(parseMessage("")).toEqual([]);
    expect(parseMessage("\n\n")).toEqual([]);
  });
});
