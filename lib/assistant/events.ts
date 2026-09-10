/**
 * What the assistant's route streams to the panel, and how the panel
 * reads it back: one framing for both ends, so the two cannot drift.
 *
 * Server-sent events over a POST body's stream: `event: <type>` and
 * `data: <json>` per frame, a blank line between frames. The panel
 * cannot use EventSource (it must POST), so it reads the body itself
 * and splits frames with decodeEvents.
 */

export interface Source {
  url: string;
  title: string | null;
}

export type AssistantEvent =
  | { type: "status"; kind: "search" | "fetch" | "tool"; label: string }
  | { type: "text"; delta: string }
  | { type: "sources"; sources: Source[] }
  | {
      type: "done";
      charged: number;
      balance: number | null;
      used?: number;
      cap?: number;
    }
  | { type: "error"; reason: string; detail?: string };

export function encodeEvent(event: AssistantEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

const TYPES = new Set(["status", "text", "sources", "done", "error"]);

/**
 * The complete frames in a buffer, and what is left of it: the tail
 * may be half a frame, and is handed back to be prepended to the next
 * chunk. A frame that does not parse is dropped, not thrown.
 */
export function decodeEvents(buffer: string): { events: AssistantEvent[]; rest: string } {
  const events: AssistantEvent[] = [];
  let rest = buffer;
  for (;;) {
    const cut = rest.indexOf("\n\n");
    if (cut < 0) break;
    const frame = rest.slice(0, cut);
    rest = rest.slice(cut + 2);
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      const parsed = JSON.parse(data) as { type?: unknown };
      if (parsed && typeof parsed.type === "string" && TYPES.has(parsed.type)) {
        events.push(parsed as AssistantEvent);
      }
    } catch {
      // Half a frame that happened to contain a blank line: not ours.
    }
  }
  return { events, rest };
}
