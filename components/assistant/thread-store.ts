/**
 * The threads, kept for the tab.
 *
 * One thread per thing looked at — a property, a search — keyed by the
 * context's id, so closing the panel and opening it again finds the
 * conversation where it was, and a different property gets a fresh
 * one. Nothing is written anywhere: a reload starts over, which is
 * the honest state of a feature whose answers are a message away.
 *
 * A plain external store, read with useSyncExternalStore: the panel
 * re-renders on every change and nothing else does, and the streaming
 * happens here rather than in a component that may unmount mid-reply.
 */

import type { AssistantContext } from "@/lib/assistant/context";
import { decodeEvents, type Source } from "@/lib/assistant/events";

export interface Step {
  kind: "search" | "fetch" | "tool";
  label: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: "streaming" | "done" | "error";
  /** What the reply did on the way: each search, read and check. */
  steps: Step[];
  sources: Source[];
  /** Why a reply stopped short, by the route's reason. */
  error?: string;
  charged?: number;
}

export interface Thread {
  key: string;
  messages: ChatMessage[];
  busy: boolean;
  open: boolean;
  draft: string;
}

export type SendOutcome = "sent" | "no-credits" | "plan-required" | "failed";

const threads = new Map<string, Thread>();
const listeners = new Set<() => void>();

const fresh = (key: string): Thread => ({ key, messages: [], busy: false, open: false, draft: "" });

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The thread for a key: the same object until something changes. */
export function getThread(key: string): Thread {
  let thread = threads.get(key);
  if (!thread) {
    thread = fresh(key);
    threads.set(key, thread);
  }
  return thread;
}

function update(key: string, fn: (thread: Thread) => Thread): void {
  threads.set(key, fn(getThread(key)));
  for (const listener of listeners) listener();
}

function patchMessage(key: string, id: string, fn: (m: ChatMessage) => ChatMessage): void {
  update(key, (t) => ({ ...t, messages: t.messages.map((m) => (m.id === id ? fn(m) : m)) }));
}

export function setOpen(key: string, open: boolean): void {
  update(key, (t) => (t.open === open ? t : { ...t, open }));
}

/** A thread as given, for a harness or a test. Never called by the app. */
export function seedThread(key: string, messages: ChatMessage[], open = true): void {
  update(key, (t) => ({ ...t, messages, open, busy: messages.some((m) => m.status === "streaming") }));
}

export function setDraft(key: string, draft: string): void {
  update(key, (t) => (t.draft === draft ? t : { ...t, draft }));
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * One message, sent, and its reply streamed into the thread.
 *
 * Refusals before the model is asked — no credits, a plan without the
 * feature — take the message back out and put the words back in the
 * box, so nothing looks sent that was not. Anything after that stays
 * on screen with what went wrong and a way to try again.
 */
export async function send(
  key: string,
  context: AssistantContext,
  text: string,
  opts: { fetcher?: typeof fetch } = {}
): Promise<SendOutcome> {
  const thread = getThread(key);
  const message = text.trim();
  if (!message || thread.busy) return "failed";

  const history = thread.messages
    .filter((m) => m.status !== "error" && m.text.trim() !== "")
    .map((m) => ({ role: m.role, text: m.text }));
  const userId = newId();
  const replyId = newId();
  const requestKey = newId();

  update(key, (t) => ({
    ...t,
    busy: true,
    draft: "",
    messages: [
      ...t.messages,
      { id: userId, role: "user", text: message, status: "done", steps: [], sources: [] },
      { id: replyId, role: "assistant", text: "", status: "streaming", steps: [], sources: [] },
    ],
  }));

  const withdraw = () =>
    update(key, (t) => ({
      ...t,
      draft: t.draft || message,
      messages: t.messages.filter((m) => m.id !== userId && m.id !== replyId),
    }));
  const fail = (reason: string) =>
    patchMessage(key, replyId, (m) => ({ ...m, status: "error", error: reason }));

  try {
    const res = await (opts.fetcher ?? fetch)("/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context, history, message, key: requestKey }),
    });
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => null)) as { reason?: string } | null;
      const reason = body?.reason ?? (res.status === 402 ? "no-credits" : "network");
      if (reason === "no-credits" || reason === "plan-required") {
        withdraw();
        return reason;
      }
      fail(reason);
      return "failed";
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let pendingText = "";
    let settled = false;
    const flush = () => {
      if (!pendingText) return;
      const delta = pendingText;
      pendingText = "";
      patchMessage(key, replyId, (m) => ({ ...m, text: m.text + delta }));
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = decodeEvents(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        if (event.type === "text") {
          pendingText += event.delta;
          continue;
        }
        flush();
        if (event.type === "status") {
          patchMessage(key, replyId, (m) => ({ ...m, steps: [...m.steps, { kind: event.kind, label: event.label }] }));
        } else if (event.type === "sources") {
          patchMessage(key, replyId, (m) => ({ ...m, sources: event.sources }));
        } else if (event.type === "done") {
          settled = true;
          patchMessage(key, replyId, (m) => ({ ...m, status: "done", charged: event.charged }));
        } else if (event.type === "error") {
          settled = true;
          fail(event.reason);
        }
      }
      flush();
    }
    if (!settled) {
      // The line closed before the route said how it ended: an answer
      // that arrived stands, an empty one is a failure.
      patchMessage(key, replyId, (m) =>
        m.text.trim() ? { ...m, status: "done" } : { ...m, status: "error", error: "network" }
      );
    }
    return "sent";
  } catch {
    fail("network");
    return "failed";
  } finally {
    update(key, (t) => ({ ...t, busy: false }));
  }
}
