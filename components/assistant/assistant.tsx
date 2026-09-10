"use client";

/**
 * The assistant: a launcher in the corner, a panel that rises from it.
 *
 * One component for the analysis page and the Deal Finder, told what
 * it is looking at (lib/assistant/context) and nothing else. The
 * launcher is the page's one standing invitation; the panel is a
 * window on the right, above the page rather than in it, so the page
 * keeps its shape and the conversation keeps its place.
 *
 * Every reply is a credit (config/app ASSISTANT_MESSAGE_CREDITS), and
 * the panel says so in its header rather than beside every message.
 * A plan without the feature sees the launcher and is offered the
 * plan that has it; an account out of credits is offered credits.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { ArrowUp, ExternalLink, RotateCcw, Sparkles, X } from "lucide-react";
import { useSession } from "@/components/providers/session-provider";
import { ASSISTANT_MESSAGE_CREDITS } from "@/config/app";
import { contextTitle, suggestionsFor, type AssistantContext } from "@/lib/assistant/context";
import { PRICE_LINE } from "@/lib/assistant/prompt";
import type { Source } from "@/lib/assistant/events";
import { cn } from "@/lib/utils";
import { MessageText } from "./message-text";
import { getThread, send, setDraft, setOpen, subscribe, type ChatMessage, type Step } from "./thread-store";

const noop = () => () => {};
/** Rendered in a portal, which exists only in a browser. */
const useIsClient = () => React.useSyncExternalStore(noop, () => true, () => false);

export function Assistant({ context }: { context: AssistantContext }) {
  const isClient = useIsClient();
  const key = context.id;
  const thread = React.useSyncExternalStore(
    subscribe,
    () => getThread(key),
    () => getThread(key)
  );
  const { tier, creditsRemaining, credits, openUpgrade, refreshUsage } = useSession();
  const eligible = tier.assistant;
  const affordable = creditsRemaining + credits >= ASSISTANT_MESSAGE_CREDITS;
  /** The panel stays mounted through its exit animation. */
  const [closing, setClosing] = React.useState(false);

  const open = () => {
    if (!eligible) {
      openUpgrade({ reason: "generic" });
      return;
    }
    setClosing(false);
    setOpen(key, true);
  };
  const close = () => {
    setOpen(key, false);
    setClosing(true);
  };

  const submit = async (text: string) => {
    const message = text.trim();
    if (!message || thread.busy) return;
    if (!eligible) {
      openUpgrade({ reason: "generic" });
      return;
    }
    if (!affordable) {
      openUpgrade({ reason: "credits" });
      return;
    }
    const outcome = await send(key, context, message);
    if (outcome === "no-credits") openUpgrade({ reason: "credits" });
    else if (outcome === "plan-required") openUpgrade({ reason: "generic" });
    else if (outcome === "sent") void refreshUsage();
  };

  if (!isClient) return null;

  const showPanel = thread.open || closing;
  const label = context.kind === "property" ? "Ask about this property" : "Ask about these rentals";

  return createPortal(
    <>
      <button
        type="button"
        onClick={open}
        data-state={thread.open ? "closed" : "open"}
        aria-label={label}
        className={cn(
          "fixed right-5 bottom-5 z-40 inline-flex items-center gap-2 rounded-full bg-gold-fill py-2.5 pr-4 pl-3.5 text-sm font-semibold text-[#1c1503] print:hidden",
          "shadow-[0_2px_4px_rgba(16,16,18,0.12),0_10px_28px_rgba(227,179,65,0.42)] transition-[transform,box-shadow,background-color,opacity] duration-200",
          "hover:-translate-y-0.5 hover:bg-[#ecbf4f] hover:shadow-[0_3px_6px_rgba(16,16,18,0.14),0_14px_34px_rgba(227,179,65,0.5)] active:translate-y-0",
          "data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0 data-[state=closed]:translate-y-2",
          "max-sm:right-3 max-sm:bottom-3"
        )}
      >
        <span className="relative flex">
          <span aria-hidden className="absolute -inset-1 rounded-full bg-[#1c1503]/10 animate-assistant-halo" />
          <Sparkles aria-hidden className="relative size-4" strokeWidth={2.25} />
        </span>
        {label}
        {!eligible ? (
          <span className="rounded-full bg-[#1c1503]/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase">
            Pro
          </span>
        ) : null}
      </button>

      {showPanel ? (
        <Panel
          context={context}
          messages={thread.messages}
          busy={thread.busy}
          draft={thread.draft}
          state={thread.open ? "open" : "closed"}
          affordable={affordable}
          onDraft={(v) => setDraft(key, v)}
          onSubmit={submit}
          onClose={close}
          onGone={() => setClosing(false)}
        />
      ) : null}
    </>,
    document.body
  );
}

function Panel({
  context,
  messages,
  busy,
  draft,
  state,
  affordable,
  onDraft,
  onSubmit,
  onClose,
  onGone,
}: {
  context: AssistantContext;
  messages: ChatMessage[];
  busy: boolean;
  draft: string;
  state: "open" | "closed";
  affordable: boolean;
  onDraft: (value: string) => void;
  onSubmit: (text: string) => void;
  onClose: () => void;
  /** The exit animation has finished: the panel may go. */
  onGone: () => void;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  /** Follow the reply down, unless the reader has scrolled up to read. */
  const stick = React.useRef(true);

  React.useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  React.useEffect(() => {
    if (state === "open") inputRef.current?.focus();
  }, [state]);

  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  };

  const canSend = !busy && draft.trim() !== "";
  const last = messages[messages.length - 1];

  return (
    <section
      role="dialog"
      aria-label="Assistant"
      data-state={state}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && state === "closed") onGone();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      className={cn(
        "fixed right-5 bottom-5 z-40 flex h-[min(44rem,calc(100dvh-6.5rem))] w-[min(26.5rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-border bg-card print:hidden",
        "shadow-[0_28px_90px_-28px_rgba(16,16,18,0.5),0_10px_28px_-14px_rgba(16,16,18,0.3)]",
        "duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-6",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-bottom-6 data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0",
        "max-sm:inset-x-3 max-sm:bottom-3 max-sm:h-[min(44rem,calc(100dvh-5rem))] max-sm:w-auto"
      )}
    >
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-gold-fill/15 text-gold">
          {busy ? <span aria-hidden className="absolute inset-0 rounded-full bg-gold-fill/35 animate-assistant-halo" /> : null}
          <Sparkles aria-hidden className="relative size-4" strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Assistant</p>
          <p className="truncate text-xs text-muted-foreground">{contextTitle(context)}</p>
        </div>
        <span className="shrink-0 text-[11px] whitespace-nowrap text-muted-foreground">{PRICE_LINE}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 56;
        }}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 [scrollbar-gutter:stable]"
      >
        {messages.length === 0 ? (
          <Opening context={context} onPick={onSubmit} />
        ) : (
          messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              onRetry={
                m.status === "error" && m === last
                  ? () => {
                      const prompt = [...messages].reverse().find((x) => x.role === "user");
                      if (prompt) onSubmit(prompt.text);
                    }
                  : undefined
              }
            />
          ))
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(draft);
        }}
        className="border-t border-border p-3"
      >
        <div
          className={cn(
            "flex items-end gap-2 rounded-lg border border-border bg-background px-3 py-2 transition-[border-color,box-shadow] duration-150",
            "focus-within:border-gold/60 focus-within:ring-[3px] focus-within:ring-gold/15"
          )}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => {
              onDraft(e.target.value);
              grow(e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onSubmit(draft);
              }
            }}
            placeholder={context.kind === "property" ? "Ask anything about this property…" : "Ask anything about these rentals…"}
            aria-label="Message"
            className="max-h-32 min-h-6 flex-1 resize-none bg-transparent py-0.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            title={affordable ? undefined : "Out of credits"}
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full bg-gold-fill text-[#1c1503] transition-[background-color,transform,opacity] duration-150",
              "hover:bg-[#ecbf4f] active:translate-y-px disabled:opacity-35 disabled:hover:bg-gold-fill"
            )}
          >
            <ArrowUp aria-hidden className="size-4" strokeWidth={2.5} />
          </button>
        </div>
      </form>
    </section>
  );
}

function Opening({ context, onPick }: { context: AssistantContext; onPick: (text: string) => void }) {
  return (
    <div className="flex flex-1 flex-col justify-end gap-4 pb-1">
      <div className="animate-assistant-rise">
        <span className="flex size-10 items-center justify-center rounded-full bg-gold-fill/15 text-gold">
          <Sparkles aria-hidden className="size-5" strokeWidth={2.25} />
        </span>
        <p className="mt-3 font-display text-lg font-semibold tracking-tight text-foreground">
          {context.kind === "property" ? "Ask about this property" : "Ask about these rentals"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          The listing, who runs it, the local rules, the numbers. Answers come with the pages they came from.
        </p>
      </div>
      <div className="flex flex-col items-start gap-1.5">
        {suggestionsFor(context).map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            style={{ animationDelay: `${90 + i * 60}ms` }}
            className="animate-assistant-rise rounded-full border border-border bg-background px-3 py-1.5 text-left text-xs font-medium text-foreground transition-[border-color,background-color,transform] duration-150 hover:border-gold/60 hover:bg-gold-fill/10 active:translate-y-px"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageRow({ message: m, onRetry }: { message: ChatMessage; onRetry?: () => void }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end animate-assistant-rise">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
          {m.text}
        </div>
      </div>
    );
  }
  const working = m.status === "streaming";
  const step = m.steps[m.steps.length - 1];
  return (
    <div className="flex gap-2.5 animate-assistant-rise">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-gold-fill/15 text-gold">
        <Sparkles aria-hidden className="size-3.5" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        {working && step ? <StatusLine step={step} /> : null}
        {m.text ? <MessageText text={m.text} streaming={working} /> : working && !step ? <TypingDots /> : null}
        {m.status === "error" ? <Failure reason={m.error} onRetry={onRetry} /> : null}
        {!working && m.steps.length > 0 ? (
          <p className="text-[11px] text-muted-foreground">{trail(m.steps)}</p>
        ) : null}
        {m.sources.length > 0 ? <Sources sources={m.sources} /> : null}
      </div>
    </div>
  );
}

function StatusLine({ step }: { step: Step }) {
  return (
    <p key={step.label} className="flex items-center gap-2 text-xs text-muted-foreground animate-assistant-rise">
      <span className="relative flex size-2 shrink-0">
        <span aria-hidden className="absolute inset-0 rounded-full bg-gold-fill animate-assistant-halo" />
        <span className="relative size-2 rounded-full bg-gold-fill" />
      </span>
      <span className="truncate">{step.label}</span>
    </p>
  );
}

function TypingDots() {
  return (
    <p aria-label="Thinking" className="flex h-6 items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{ animationDelay: `${i * 160}ms` }}
          className="size-1.5 rounded-full bg-muted-foreground/70 animate-assistant-dot"
        />
      ))}
    </p>
  );
}

/** What a finished reply did, in a line. */
function trail(steps: Step[]): string {
  const searches = steps.filter((s) => s.kind === "search" && s.label.startsWith("Searching:")).length;
  const reads = steps.filter((s) => s.kind === "fetch" && s.label.startsWith("Reading ") && s.label !== "Reading a page").length;
  const checked = steps.some((s) => s.kind === "tool");
  const parts: string[] = [];
  if (checked) parts.push("Checked the listing sites");
  if (searches > 0) parts.push(`searched the web ${searches === 1 ? "once" : `${searches} times`}`);
  if (reads > 0) parts.push(`read ${reads} page${reads === 1 ? "" : "s"}`);
  if (parts.length === 0) return "";
  const line = parts.join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Sources({ sources }: { sources: Source[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {sources.map((s) => (
        <a
          key={s.url}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          title={s.title ?? s.url}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground transition-colors duration-150 hover:border-gold/60 hover:text-foreground"
        >
          <span className="truncate">{hostOf(s.url)}</span>
          <ExternalLink aria-hidden className="size-3 shrink-0" />
        </a>
      ))}
    </div>
  );
}

function failureCopy(reason: string | undefined): string {
  switch (reason) {
    case "refused":
      return "That's not something I can help with.";
    case "not-configured":
    case "auth":
      return "The assistant isn't set up on this deployment yet.";
    case "busy":
      return "The assistant is busy right now. Try again in a moment. Nothing was charged.";
    case "empty":
      return "No answer came back. Nothing was charged.";
    case "signed-out":
      return "Sign in again to use the assistant.";
    default:
      return "That didn't go through. Nothing was charged.";
  }
}

function Failure({ reason, onRetry }: { reason: string | undefined; onRetry?: () => void }) {
  const retryable = reason !== "refused" && reason !== "not-configured" && reason !== "auth";
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      {failureCopy(reason)}
      {retryable && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 font-medium text-gold transition-colors duration-150 hover:text-gold-bright"
        >
          <RotateCcw aria-hidden className="size-3.5" />
          Try again
        </button>
      ) : null}
    </p>
  );
}
