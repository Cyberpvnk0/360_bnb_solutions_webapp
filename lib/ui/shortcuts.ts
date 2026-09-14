/**
 * The app's keyboard accelerators, in one place.
 *
 * Somebody running thirty analyses a week should not have to reach for
 * the mouse to start the thirty-first. Three keys, chosen to be the
 * ones people already try: "/" for search, as every list-and-search
 * product has had since the 1990s; the platform's own command key with
 * K to jump to markets; Escape to back out of whatever is open.
 *
 * WHAT COUNTS AS TYPING IS THE WHOLE PROBLEM. A global "/" handler that
 * fires while somebody is writing a note steals the slash out of their
 * sentence. So the decision is made once, here, where it can be tested
 * without a browser — and it is made by duck-typing rather than
 * `instanceof HTMLInputElement`, which is wrong across frames and
 * undefined outside one.
 */

export type Shortcut = "search" | "markets";

/** The shape of a key event this needs, and no more. */
export interface Keyish {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: unknown;
}

/**
 * Is focus somewhere a keystroke belongs to the person typing?
 *
 * Inputs, textareas and anything contenteditable. A checkbox or a
 * button is NOT a typing target — "/" pressed with a button focused
 * should still reach the search box.
 */
export function isTypingTarget(target: unknown): boolean {
  const el = target as
    | { tagName?: unknown; isContentEditable?: unknown; type?: unknown }
    | null
    | undefined;
  if (!el || typeof el !== "object") return false;
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  // A button-like input takes clicks, not prose.
  const type = typeof el.type === "string" ? el.type.toLowerCase() : "text";
  return !["button", "submit", "reset", "checkbox", "radio", "range", "file"].includes(
    type
  );
}

/**
 * Which accelerator this event is, if any.
 *
 * The command chord fires even while typing — it is a deliberate
 * two-handed gesture and cannot be struck by accident mid-word — and
 * the bare slash does not.
 */
export function shortcutFor(e: Keyish): Shortcut | null {
  const chord = e.metaKey === true || e.ctrlKey === true;
  if (chord && !e.altKey && e.key.toLowerCase() === "k") return "markets";
  if (chord || e.altKey) return null;
  if (e.key === "/" && !isTypingTarget(e.target)) return "search";
  return null;
}

/** The chord as this platform writes it, for a visible hint. */
export function chordLabel(platform: string | undefined): string {
  return /mac|iphone|ipad|ipod/i.test(platform ?? "") ? "⌘K" : "Ctrl K";
}
