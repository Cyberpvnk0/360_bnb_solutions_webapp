/**
 * One message, answered: the loop between the model and its tools,
 * streamed to the panel as it goes.
 *
 * A turn is one or more requests. The model answers, or asks for a
 * tool; a tool of ours runs here and its result goes back; a tool of
 * Anthropic's runs on their side, and a long run of them comes back
 * paused to be resumed as-is. Text is forwarded the moment it arrives,
 * each search and read is announced so the panel can show what is
 * happening, and the pages the answer rests on are gathered up at the
 * end.
 *
 * The client is injected so the loop can be exercised without a
 * network: anything with `stream()` returning an async iterable of
 * the SDK's events with a `finalMessage()` on it.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { AssistantEvent, Source } from "./events";
import type { ToolOutcome } from "./tools";

/** Sonnet: quick, and every task here is a search and a short answer. */
export const MODEL = "claude-sonnet-5";
export const MAX_TOKENS = 4096;
/** Requests one message may take: a pause resumed, a tool answered. */
export const MAX_ROUNDS = 8;
const MAX_SOURCES = 6;

export interface StreamLike extends AsyncIterable<Anthropic.MessageStreamEvent> {
  finalMessage(): Promise<Anthropic.Message>;
  abort?: () => void;
}

export interface TurnDeps {
  stream: (params: Anthropic.MessageStreamParams) => StreamLike;
  runTool: (name: string, input: unknown) => Promise<ToolOutcome>;
  emit: (event: AssistantEvent) => void;
  /** Each live stream, so a caller can abort it when the reader goes. */
  onStream?: (stream: StreamLike) => void;
  maxRounds?: number;
}

export interface TurnResult {
  text: string;
  sources: Source[];
  stopReason: Anthropic.Message["stop_reason"] | null;
  rounds: number;
  searches: number;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** What a server tool was asked, once its input has fully arrived. */
function statusFor(name: string, json: string): AssistantEvent | null {
  let input: Record<string, unknown> = {};
  try {
    input = JSON.parse(json) as Record<string, unknown>;
  } catch {
    // Partial or odd input: the generic line already went out.
  }
  if (name === "web_search") {
    const q = typeof input.query === "string" ? input.query.trim() : "";
    return { type: "status", kind: "search", label: q ? `Searching: ${q.slice(0, 80)}` : "Searching the web" };
  }
  if (name === "web_fetch") {
    const u = typeof input.url === "string" ? input.url : "";
    return { type: "status", kind: "fetch", label: u ? `Reading ${hostOf(u)}` : "Reading a page" };
  }
  return null;
}

export async function runTurn(
  params: {
    system: Anthropic.MessageStreamParams["system"];
    tools: Anthropic.ToolUnion[];
    messages: Anthropic.MessageParam[];
  },
  deps: TurnDeps
): Promise<TurnResult> {
  const messages = [...params.messages];
  const maxRounds = deps.maxRounds ?? MAX_ROUNDS;
  let text = "";
  let searches = 0;
  let stopReason: TurnResult["stopReason"] = null;
  const cited: Source[] = [];
  const read: Source[] = [];
  const found: Source[] = [];
  let rounds = 0;

  for (; rounds < maxRounds; ) {
    rounds += 1;
    const stream = deps.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: params.system,
      tools: params.tools,
      messages: [...messages],
      output_config: { effort: "medium" },
    });
    deps.onStream?.(stream);

    /** Server-tool inputs arrive in pieces; the announcement waits for
     *  the whole. */
    const pending = new Map<number, { name: string; json: string }>();

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "server_tool_use") {
          pending.set(event.index, { name: block.name, json: "" });
          if (block.name === "web_search") {
            deps.emit({ type: "status", kind: "search", label: "Searching the web" });
          } else if (block.name === "web_fetch") {
            deps.emit({ type: "status", kind: "fetch", label: "Reading a page" });
          }
        } else if (block.type === "tool_use") {
          deps.emit({ type: "status", kind: "tool", label: "Checking the listing sites" });
        } else if (block.type === "web_search_tool_result") {
          searches += 1;
          if (Array.isArray(block.content)) {
            for (const r of block.content) {
              if (r.type === "web_search_result") found.push({ url: r.url, title: r.title });
            }
          }
        } else if (block.type === "web_fetch_tool_result") {
          const c = block.content;
          if (c.type === "web_fetch_result") {
            read.push({ url: c.url, title: c.content.title ?? null });
          }
        }
      } else if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          text += delta.text;
          deps.emit({ type: "text", delta: delta.text });
        } else if (delta.type === "input_json_delta") {
          const p = pending.get(event.index);
          if (p) p.json += delta.partial_json;
        } else if (delta.type === "citations_delta") {
          const c = delta.citation;
          if (c.type === "web_search_result_location") cited.push({ url: c.url, title: c.title });
        }
      } else if (event.type === "content_block_stop") {
        const p = pending.get(event.index);
        if (p) {
          pending.delete(event.index);
          const status = statusFor(p.name, p.json);
          if (status) deps.emit(status);
        }
      }
    }

    const message = await stream.finalMessage();
    stopReason = message.stop_reason;
    messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "pause_turn") continue;

    if (message.stop_reason === "tool_use") {
      const calls = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (calls.length === 0) break;
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of calls) {
        const out = await deps.runTool(call.name, call.input);
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: out.content,
          ...(out.isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    break;
  }

  // The pages the answer rests on: what it cited, then what it read,
  // then what it found, each once.
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const s of [...cited, ...read, ...found]) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    sources.push(s);
    if (sources.length >= MAX_SOURCES) break;
  }
  if (sources.length > 0) deps.emit({ type: "sources", sources });

  return { text, sources, stopReason, rounds, searches };
}
