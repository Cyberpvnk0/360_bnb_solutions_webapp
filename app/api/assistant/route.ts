/**
 * One message to the assistant, answered as a stream.
 *
 *   POST /api/assistant  { context, history, message, key }
 *
 * The context is what the page is looking at (lib/assistant/context);
 * the history is the thread so far, as text; the message is the new
 * one; the key is the browser's name for it, so a retry of the same
 * message is one charge and not two. The answer comes back as
 * server-sent events (lib/assistant/events): each search and read as
 * it happens, the text as it arrives, the sources at the end, and
 * last the charge.
 *
 * A paid feature on the plans that carry it, priced in credits
 * (config/app ASSISTANT_MESSAGE_CREDITS): the account's room is read
 * before the model is asked, and the credit is taken after it has
 * answered. A message that produced no answer — the model refused, or
 * the line dropped — costs nothing.
 */

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { ASSISTANT_MESSAGE_CREDITS, TIERS } from "@/config/app";
import { readContext, renderContext } from "@/lib/assistant/context";
import { encodeEvent, type AssistantEvent } from "@/lib/assistant/events";
import { SYSTEM_PROMPT } from "@/lib/assistant/prompt";
import { assistantTools, runTool } from "@/lib/assistant/tools";
import { assistantConfigured, MODEL, runTurn, type StreamLike } from "@/lib/assistant/turn";
import { requireOperator, requirePaid } from "@/lib/auth/gate";
import { canCover, spendCredits } from "@/lib/db/usage";

/** A research answer is several searches and reads in a row. */
export const maxDuration = 120;

const MAX_MESSAGE = 2_000;
const MAX_HISTORY = 24;
const MAX_HISTORY_TEXT = 8_000;

type Turn = { role: "user" | "assistant"; content: string };

function readHistory(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  const turns: Turn[] = [];
  for (const item of raw.slice(-MAX_HISTORY)) {
    if (!item || typeof item !== "object") continue;
    const { role, text } = item as { role?: unknown; text?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof text !== "string") continue;
    const content = text.trim().slice(0, MAX_HISTORY_TEXT);
    if (!content) continue;
    turns.push({ role, content });
  }
  // The thread opens with the person, and a turn never answers itself
  // twice: the model needs the shape it was trained on.
  while (turns.length > 0 && turns[0].role !== "user") turns.shift();
  return turns.filter((t, i) => i === 0 || t.role !== turns[i - 1].role);
}

function reasonOf(error: unknown): { reason: string; detail?: string } {
  if (error instanceof Anthropic.AuthenticationError) return { reason: "auth" };
  if (error instanceof Anthropic.RateLimitError) return { reason: "busy" };
  if (error instanceof Anthropic.APIError) {
    return { reason: "http", detail: `${error.status ?? ""} ${error.message}`.trim().slice(0, 400) };
  }
  if (error instanceof Error && error.name === "AbortError") return { reason: "aborted" };
  return { reason: "network", detail: error instanceof Error ? error.message.slice(0, 200) : undefined };
}

/**
 * The operator's check: is this deployment able to answer at all?
 *
 *   GET /api/assistant            (a named admin, signed in)
 *   GET /api/assistant?secret=…   (CRON_SECRET)
 *
 * One minimal request with the assistant's exact tools, and the API's
 * own answer — or its own words for what it refused — so a key that
 * is missing, unpaid or unable to search says which, here, verbatim.
 * Nothing is metered: it is the operator's, and it costs a few tokens.
 */
export async function GET(request: Request) {
  const op = await requireOperator(request);
  if (!op.ok) return op.response;
  if (!assistantConfigured()) {
    return NextResponse.json({ ok: false, reason: "not-configured", model: MODEL, hint: "ANTHROPIC_API_KEY is not set on this deployment" }, { status: 503 });
  }
  const client = new Anthropic({ maxRetries: 0 });
  const started = Date.now();
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 32,
      system: "Reply with the single word: ok",
      tools: assistantTools(),
      messages: [{ role: "user", content: "ping" }],
    });
    return NextResponse.json({
      ok: true,
      model: message.model,
      stopReason: message.stop_reason,
      text: message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join(""),
      usage: message.usage,
      ms: Date.now() - started,
    });
  } catch (error) {
    const { reason, detail } = reasonOf(error);
    return NextResponse.json(
      {
        ok: false,
        reason,
        status: error instanceof Anthropic.APIError ? error.status : null,
        detail: detail ?? (error instanceof Error ? error.message.slice(0, 400) : String(error)),
        model: MODEL,
        ms: Date.now() - started,
      },
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  const paid = await requirePaid();
  if (!paid.ok) return paid.response;
  if (!TIERS[paid.tier].assistant) {
    return NextResponse.json({ ok: false, reason: "plan-required", tier: paid.tier }, { status: 403 });
  }
  if (!assistantConfigured()) {
    return NextResponse.json({ ok: false, reason: "not-configured" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as {
    context?: unknown;
    history?: unknown;
    message?: unknown;
    key?: unknown;
  } | null;
  const context = readContext(body?.context);
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE) : "";
  const key = typeof body?.key === "string" && /^[\w-]{8,64}$/.test(body.key) ? body.key : null;
  if (!context || !message || !key) {
    return NextResponse.json({ ok: false, reason: "bad-request" }, { status: 400 });
  }
  const history = readHistory(body?.history);

  // Room first, then the model, then the charge.
  const cover = await canCover(paid.user.id, paid.tier, ASSISTANT_MESSAGE_CREDITS);
  if (!cover.ok) {
    return NextResponse.json(
      { ok: false, reason: "no-credits", remaining: cover.remaining, cost: ASSISTANT_MESSAGE_CREDITS },
      { status: 402 }
    );
  }

  const client = new Anthropic();
  // The frozen instructions, then the page's context: two cache
  // breakpoints, so a thread's second message pays for neither again.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { type: "text", text: renderContext(context), cache_control: { type: "ephemeral" } },
  ];
  const messages: Anthropic.MessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user" as const, content: message },
  ];

  const encoder = new TextEncoder();
  let live: StreamLike | null = null;
  let closed = false;
  const { user, tier } = paid;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AssistantEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        } catch {
          closed = true;
        }
      };
      try {
        const result = await runTurn(
          { system, tools: assistantTools(), messages },
          {
            stream: (params) => client.messages.stream(params),
            runTool,
            emit,
            onStream: (s) => {
              live = s;
            },
          }
        );
        if (closed) return;
        if (!result.text.trim()) {
          emit({ type: "error", reason: result.stopReason === "refusal" ? "refused" : "empty" });
          return;
        }
        // Answered: the credit. A refusal here is a race with a spend
        // that landed in between reading the room and asking; the
        // answer has gone out, unbilled, rather than being taken back.
        const spend = await spendCredits(user.id, tier, `assistant:${key}`, ASSISTANT_MESSAGE_CREDITS);
        emit({
          type: "done",
          charged: spend.allowed ? spend.charged : 0,
          balance: spend.balance ?? null,
          used: spend.used,
          cap: spend.cap,
        });
      } catch (error) {
        const why = reasonOf(error);
        console.error(`[assistant] ${why.reason}${why.detail ? `: ${why.detail}` : ""}`);
        emit({ type: "error", ...why });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by the reader going away.
        }
      }
    },
    cancel() {
      closed = true;
      live?.abort?.();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
