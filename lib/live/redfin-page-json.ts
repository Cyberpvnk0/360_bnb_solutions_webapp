/**
 * The JSON a Redfin search page carries inside itself.
 *
 * The supplier's structured Redfin endpoint parses FOR-SALE searches
 * and answers 500 for every rental URL — measured, not guessed:
 * Boston's city page returned 43 rows while all four rental URL
 * spellings failed, and the same rental URL fetched through the plain
 * endpoint returned 3.3MB of HTML carrying listing JSON. So the page
 * is there and only their parser is missing; this reads it ourselves.
 *
 * NOTHING HERE ASSUMES A SHAPE. The first cut of the Redfin adapter
 * cost this project days by inferring field names from what looked
 * reasonable, and this module exists downstream of that lesson: it
 * finds the embedded blobs, and a diagnostic reports their real
 * structure so the mapper is written against what is actually sent.
 *
 * THE ONE RULE, inherited from lib/live/scraperapi: the document is a
 * local. It is never returned, stored, or logged. What leaves here is
 * structure — key names and value types — or, later, listing FACTS.
 * Never a description, never a photo, never a paragraph somebody owns.
 */

/** A JSON object found in the page, with where it came from. */
export interface PageBlob {
  /** The text that introduced it, so a reader can find it again. */
  marker: string;
  bytes: number;
  value: unknown;
}

/**
 * Markers Redfin has used to hang its server state off the window.
 *
 * Tried in order and all of them reported, because a page can carry
 * several and only one holds the search rows. A marker that matches
 * nothing costs nothing.
 */
const ASSIGNMENT_MARKERS = [
  "root.__reactServerState.InitialContext",
  "__reactServerState.InitialContext",
  "root.__reactServerState",
  "window.__INITIAL_STATE__",
  "__NEXT_DATA__",
];

/**
 * Balance braces from `start` and return the object's text.
 *
 * A regex cannot do this: the payload holds braces inside strings, and
 * a lazy match stops at the first `}` in a description. This walks the
 * document counting depth and respecting string literals and escapes.
 */
export function objectAt(doc: string, start: number): string | null {
  if (doc[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < doc.length; i += 1) {
    const ch = doc[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return doc.slice(start, i + 1);
    }
  }
  return null;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Every embedded JSON object this page carries, largest first.
 *
 * Both shapes: a script tag whose whole body is JSON, and an
 * assignment to a window global, which is what Redfin has used.
 */
export function findJsonBlobs(doc: string, minBytes = 2_000): PageBlob[] {
  const found: PageBlob[] = [];
  /**
   * Where each object began, so one assignment is reported once.
   *
   * The markers deliberately overlap — "root.__reactServerState" is a
   * prefix of "root.__reactServerState.InitialContext" — so a single
   * blob matches several of them and, without this, a shape report
   * would show the same payload three times and read as three
   * different places the rows might live.
   */
  const seen = new Set<number>();

  for (const marker of ASSIGNMENT_MARKERS) {
    let from = 0;
    for (;;) {
      const at = doc.indexOf(marker, from);
      if (at === -1) break;
      from = at + marker.length;
      const brace = doc.indexOf("{", from);
      // The opening brace has to belong to THIS assignment, not to
      // something a kilobyte further down the document.
      if (brace === -1 || brace - from > 40) continue;
      if (seen.has(brace)) continue;
      const text = objectAt(doc, brace);
      if (!text || text.length < minBytes) continue;
      const value = parse(text);
      if (value) {
        seen.add(brace);
        found.push({ marker, bytes: text.length, value });
      }
    }
  }

  // <script type="application/json"> … </script>
  const script = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = script.exec(doc)) !== null) {
    const text = m[1].trim();
    if (text.length < minBytes) continue;
    const value = parse(text);
    if (value) found.push({ marker: "script[type=application/json]", bytes: text.length, value });
  }

  return found.sort((a, b) => b.bytes - a.bytes);
}

/**
 * Arrays of objects inside a blob, by path — where search rows live.
 *
 * Reported by PATH and LENGTH only. A page holds dozens of arrays and
 * the one that matters is the long one full of objects; naming where
 * it sits is what lets a mapper be written against it.
 */
export function arraysOfObjects(
  value: unknown,
  minLength = 3,
  maxDepth = 6
): { path: string; length: number }[] {
  const out: { path: string; length: number }[] = [];
  const walk = (node: unknown, path: string, depth: number) => {
    if (depth > maxDepth || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      const objects = node.filter((x) => x && typeof x === "object" && !Array.isArray(x));
      if (node.length >= minLength && objects.length === node.length) {
        out.push({ path: path || "(root)", length: node.length });
      }
      // Still descend: a wrapper array can hold the real one.
      node.slice(0, 3).forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1));
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walk(v, path ? `${path}.${k}` : k, depth + 1);
    }
  };
  walk(value, "", 0);
  return out.sort((a, b) => b.length - a.length);
}

/** Read a path produced by arraysOfObjects back out of a blob. */
export function atPath(value: unknown, path: string): unknown {
  if (path === "(root)") return value;
  let node: unknown = value;
  for (const step of path.split(".")) {
    const m = /^([^[]*)((\[\d+\])*)$/.exec(step);
    if (!m) return undefined;
    if (m[1]) {
      if (!node || typeof node !== "object") return undefined;
      node = (node as Record<string, unknown>)[m[1]];
    }
    for (const idx of m[2].match(/\d+/g) ?? []) {
      if (!Array.isArray(node)) return undefined;
      node = node[Number(idx)];
    }
  }
  return node;
}
