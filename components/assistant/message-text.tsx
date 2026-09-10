/**
 * The assistant's words on screen.
 *
 * The model writes a little markdown — bold, links, lists — and that
 * is all this renders: no headings, no tables, no HTML, no images. A
 * link is a link only when it is an http(s) URL; anything else stays
 * text. Bare URLs become links too, since a found page is the point
 * of most answers.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "p"; lines: Inline[][] }
  | { kind: "list"; ordered: boolean; items: Inline[][] };

const INLINE =
  /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|`([^`\n]+)`|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
const LIST_ITEM = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+/;

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of line.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: line.slice(last, at) });
    if (m[1] !== undefined && m[2] !== undefined) out.push({ kind: "link", text: m[1], href: m[2] });
    else if (m[3] !== undefined) out.push({ kind: "bold", text: m[3] });
    else if (m[4] !== undefined) out.push({ kind: "code", text: m[4] });
    else if (m[5] !== undefined) out.push({ kind: "link", text: m[5], href: m[5] });
    last = at + m[0].length;
  }
  if (last < line.length) out.push({ kind: "text", text: line.slice(last) });
  return out;
}

export function parseMessage(text: string): Block[] {
  const blocks: Block[] = [];
  let para: Inline[][] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;
  const closePara = () => {
    if (para.length > 0) blocks.push({ kind: "p", lines: para });
    para = [];
  };
  const closeList = () => {
    if (list) blocks.push({ kind: "list", ...list });
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.replace(HEADING, "").trimEnd();
    if (line.trim() === "") {
      closePara();
      closeList();
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      closePara();
      const ordered = item[2] !== undefined;
      if (!list || list.ordered !== ordered) {
        closeList();
        list = { ordered, items: [] };
      }
      list.items.push(parseInline(item[3]));
      continue;
    }
    closeList();
    para.push(parseInline(line));
  }
  closePara();
  closeList();
  return blocks;
}

function InlineRun({ run }: { run: Inline[] }) {
  return (
    <>
      {run.map((piece, i) => {
        switch (piece.kind) {
          case "bold":
            return (
              <strong key={i} className="font-semibold text-foreground">
                {piece.text}
              </strong>
            );
          case "code":
            return (
              <code key={i} className="rounded-xs bg-secondary px-1 py-0.5 text-[0.85em]">
                {piece.text}
              </code>
            );
          case "link":
            return (
              <a
                key={i}
                href={piece.href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-gold underline decoration-gold/40 underline-offset-2 transition-colors duration-150 hover:text-gold-bright hover:decoration-gold-bright/60 [overflow-wrap:anywhere]"
              >
                {piece.text}
              </a>
            );
          default:
            return <React.Fragment key={i}>{piece.text}</React.Fragment>;
        }
      })}
    </>
  );
}

export function MessageText({
  text,
  streaming = false,
  className,
}: {
  text: string;
  /** True while more is arriving: a caret sits at the end. */
  streaming?: boolean;
  className?: string;
}) {
  const blocks = React.useMemo(() => parseMessage(text), [text]);
  return (
    <div className={cn("space-y-2 text-sm leading-relaxed text-foreground", className)}>
      {blocks.map((block, b) =>
        block.kind === "p" ? (
          <p key={b}>
            {block.lines.map((line, i) => (
              <React.Fragment key={i}>
                {i > 0 ? <br /> : null}
                <InlineRun run={line} />
              </React.Fragment>
            ))}
            {streaming && b === blocks.length - 1 ? <Caret /> : null}
          </p>
        ) : block.ordered ? (
          <ol key={b} className="list-decimal space-y-1 pl-5 marker:text-muted-foreground">
            {block.items.map((item, i) => (
              <li key={i}>
                <InlineRun run={item} />
              </li>
            ))}
            {streaming && b === blocks.length - 1 ? <Caret /> : null}
          </ol>
        ) : (
          <ul key={b} className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
            {block.items.map((item, i) => (
              <li key={i}>
                <InlineRun run={item} />
              </li>
            ))}
            {streaming && b === blocks.length - 1 ? <Caret /> : null}
          </ul>
        )
      )}
    </div>
  );
}

function Caret() {
  return (
    <>
      {"\u2060"}
      <span
        aria-hidden
        className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] rounded-full bg-gold animate-assistant-caret"
      />
    </>
  );
}
