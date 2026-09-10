import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { AssistantEvent } from "./events";
import { runTurn, type StreamLike } from "./turn";

type Ev = Anthropic.MessageStreamEvent;

/** A scripted round: the events it streams, then the message it settles on. */
function round(events: unknown[], final: Partial<Anthropic.Message>): StreamLike {
  const message = {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    ...final,
  } as unknown as Anthropic.Message;
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e as Ev;
    },
    finalMessage: async () => message,
  };
}

const text = (t: string) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } });

const SYSTEM = [{ type: "text" as const, text: "sys" }];
const TOOLS: Anthropic.ToolUnion[] = [];

describe("one message, answered", () => {
  it("streams the text as it arrives and finishes on end_turn", async () => {
    const stream = vi.fn(() => round([text("Hel"), text("lo")], { content: [{ type: "text", text: "Hello", citations: null }] }));
    const emit = vi.fn<(e: AssistantEvent) => void>();
    const out = await runTurn({ system: SYSTEM, tools: TOOLS, messages: [{ role: "user", content: "hi" }] }, { stream, runTool: vi.fn(), emit });
    expect(out.text).toBe("Hello");
    expect(out.rounds).toBe(1);
    expect(emit.mock.calls.map((c) => c[0])).toEqual([
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
    ]);
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-sonnet-5", system: SYSTEM, output_config: { effort: "medium" } }));
  });

  it("runs our tool, hands its result back, and carries on", async () => {
    const call = { type: "tool_use", id: "tu_1", name: "find_listing_pages", input: { address: "2262 Kingston St", city: "Jacksonville", state: "FL" } };
    const rounds = [
      round([{ type: "content_block_start", index: 0, content_block: call }], { stop_reason: "tool_use", content: [call] as never }),
      round([text("Found it.")], { content: [{ type: "text", text: "Found it.", citations: null }] }),
    ];
    const stream = vi.fn<(params: Anthropic.MessageStreamParams) => StreamLike>(() => rounds.shift()!);
    const runTool = vi.fn(async () => ({ content: '{"verified":[]}', isError: false }));
    const emit = vi.fn<(e: AssistantEvent) => void>();
    const out = await runTurn({ system: SYSTEM, tools: TOOLS, messages: [{ role: "user", content: "find it" }] }, { stream, runTool, emit });
    expect(runTool).toHaveBeenCalledWith("find_listing_pages", call.input);
    expect(out.rounds).toBe(2);
    expect(out.text).toBe("Found it.");
    const second = stream.mock.calls[1][0] as Anthropic.MessageStreamParams;
    expect(second.messages).toHaveLength(3);
    expect(second.messages[1]).toEqual({ role: "assistant", content: [call] });
    expect(second.messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_1", content: '{"verified":[]}' }],
    });
    expect(emit).toHaveBeenCalledWith({ type: "status", kind: "tool", label: "Checking the listing sites" });
  });

  it("marks a tool's failure as one, rather than as an answer", async () => {
    const call = { type: "tool_use", id: "tu_2", name: "find_listing_pages", input: {} };
    const rounds = [
      round([], { stop_reason: "tool_use", content: [call] as never }),
      round([text("Sorry.")], { content: [] }),
    ];
    const stream = vi.fn<(params: Anthropic.MessageStreamParams) => StreamLike>(() => rounds.shift()!);
    const runTool = vi.fn(async () => ({ content: "address is required", isError: true }));
    await runTurn({ system: SYSTEM, tools: TOOLS, messages: [{ role: "user", content: "x" }] }, { stream, runTool, emit: vi.fn() });
    const second = stream.mock.calls[1][0] as Anthropic.MessageStreamParams;
    expect(second.messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_2", content: "address is required", is_error: true }],
    });
  });

  it("resumes a paused turn as-is, and announces each search and read", async () => {
    const search = { type: "server_tool_use", id: "srv_1", name: "web_search", input: {} };
    const result = {
      type: "web_search_tool_result",
      tool_use_id: "srv_1",
      content: [
        { type: "web_search_result", url: "https://www.zillow.com/homedetails/2262-Kingston-St/1_zpid/", title: "2262 Kingston St", page_age: null, encrypted_content: "x" },
        { type: "web_search_result", url: "https://example.com/other", title: "Other", page_age: null, encrypted_content: "y" },
      ],
    };
    const fetchUse = { type: "server_tool_use", id: "srv_2", name: "web_fetch", input: {} };
    const rounds = [
      round(
        [
          { type: "content_block_start", index: 0, content_block: search },
          { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"\\"2262 Kingston St\\" Jacksonville"}' } },
          { type: "content_block_stop", index: 0 },
          { type: "content_block_start", index: 1, content_block: result },
        ],
        { stop_reason: "pause_turn", content: [search, result] as never }
      ),
      round(
        [
          { type: "content_block_start", index: 0, content_block: fetchUse },
          { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"url":"https://example.com/other"}' } },
          { type: "content_block_stop", index: 0 },
          text("Here: "),
          { type: "content_block_delta", index: 2, delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://example.com/other", title: "Other", cited_text: "…", encrypted_index: "e" } } },
        ],
        { content: [{ type: "text", text: "Here: ", citations: null }] }
      ),
    ];
    const stream = vi.fn<(params: Anthropic.MessageStreamParams) => StreamLike>(() => rounds.shift()!);
    const emit = vi.fn<(e: AssistantEvent) => void>();
    const out = await runTurn({ system: SYSTEM, tools: TOOLS, messages: [{ role: "user", content: "find" }] }, { stream, runTool: vi.fn(), emit });
    expect(out.rounds).toBe(2);
    expect(out.searches).toBe(1);
    const second = stream.mock.calls[1][0] as Anthropic.MessageStreamParams;
    // The paused turn goes back exactly as it came, and nothing is added after it.
    expect(second.messages).toHaveLength(2);
    expect(second.messages[1]).toEqual({ role: "assistant", content: [search, result] });
    const labels = emit.mock.calls.map((c) => c[0]).filter((e) => e.type === "status").map((e) => (e as { label: string }).label);
    expect(labels).toEqual(["Searching the web", 'Searching: "2262 Kingston St" Jacksonville', "Reading a page", "Reading example.com"]);
    // Cited first, then what was found, each once, and the answer's text.
    expect(out.sources.map((s) => s.url)).toEqual([
      "https://example.com/other",
      "https://www.zillow.com/homedetails/2262-Kingston-St/1_zpid/",
    ]);
    expect(emit).toHaveBeenLastCalledWith({ type: "sources", sources: out.sources });
  });

  it("stops at the round limit rather than looping on a tool forever", async () => {
    const call = { type: "tool_use", id: "tu_x", name: "find_listing_pages", input: {} };
    const stream = vi.fn(() => round([], { stop_reason: "tool_use", content: [call] as never }));
    const out = await runTurn(
      { system: SYSTEM, tools: TOOLS, messages: [{ role: "user", content: "x" }] },
      { stream, runTool: vi.fn(async () => ({ content: "{}", isError: false })), emit: vi.fn(), maxRounds: 3 }
    );
    expect(out.rounds).toBe(3);
    expect(stream).toHaveBeenCalledTimes(3);
    expect(out.stopReason).toBe("tool_use");
  });
});
