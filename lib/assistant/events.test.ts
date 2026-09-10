import { describe, expect, it } from "vitest";
import { decodeEvents, encodeEvent, type AssistantEvent } from "./events";

describe("the assistant's events, framed and read back", () => {
  it("round-trips every kind through the frame", () => {
    const events: AssistantEvent[] = [
      { type: "status", kind: "search", label: "Searching: 2262 Kingston St" },
      { type: "text", delta: "Found it.\n\n- one" },
      { type: "sources", sources: [{ url: "https://www.zillow.com/homedetails/1", title: "Zillow" }] },
      { type: "done", charged: 1, balance: 3, used: 12, cap: 125 },
      { type: "error", reason: "busy" },
    ];
    const wire = events.map(encodeEvent).join("");
    const out = decodeEvents(wire);
    expect(out.events).toEqual(events);
    expect(out.rest).toBe("");
  });

  it("holds back half a frame for the next chunk", () => {
    const wire = encodeEvent({ type: "text", delta: "abc" });
    const cut = wire.length - 3;
    const first = decodeEvents(wire.slice(0, cut));
    expect(first.events).toEqual([]);
    expect(first.rest).toBe(wire.slice(0, cut));
    const second = decodeEvents(first.rest + wire.slice(cut));
    expect(second.events).toEqual([{ type: "text", delta: "abc" }]);
    expect(second.rest).toBe("");
  });

  it("drops what is not an event of ours", () => {
    const out = decodeEvents('event: x\ndata: {"type":"bogus"}\n\ndata: not json\n\n: comment\n\n');
    expect(out.events).toEqual([]);
    expect(out.rest).toBe("");
  });
});
