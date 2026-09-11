/**
 * THE ATTRIBUTION STAYS. IT JUST STARTS FOLDED UP.
 *
 * "© MapTiler © OpenStreetMap contributors" is not decoration we get to
 * drop: OpenStreetMap's data licence (ODbL) and the tile provider's own
 * terms both require the credit to be visible on the map. So it is never
 * removed — it is folded to the ⓘ badge the reader can open, which is
 * the presentation MapLibre ships for exactly this purpose and which
 * both licences accept.
 *
 * Every map already asks for `attributionControl: { compact: true }`,
 * and MapLibre still renders the bar EXPANDED on arrival: the control
 * adds `maplibregl-compact` and `maplibregl-compact-show` together the
 * first time the credits have any text in them. Dropping the `-show`
 * class is what the library's own collapse paths do (its map-drag
 * handler does precisely this), so the badge, the click-to-open and the
 * keyboard focus all keep working — only the opening state changes.
 *
 * The credits fill in asynchronously as the style and its sources load,
 * and each refill re-expands the bar, so one fold on mount is not
 * enough. This keeps folding until the reader opens the bar themselves,
 * at which point it stops touching it.
 */

/** Class MapLibre puts on an attribution control that is showing its text. */
export const EXPANDED_CLASS = "maplibregl-compact-show";

/** The ⓘ badge. Clicking it is the reader asking to read the credits. */
export const BADGE_CLASS = "maplibregl-ctrl-attrib-button";

/** Events after which MapLibre may have refilled — and so re-expanded — the credits. */
export const SETTLE_EVENTS = ["styledata", "sourcedata", "idle"] as const;

const EXPANDED_SELECTOR = `.maplibregl-ctrl-attrib.${EXPANDED_CLASS}`;

/**
 * The DOM this needs, and no more. Narrow on purpose: a real MapLibre
 * container satisfies it, and so does a stand-in in the tests, which
 * run without a browser.
 */
type Expanded = { classList: { remove(name: string): void } };
type Scope = { querySelectorAll(selector: string): ArrayLike<Expanded> };
type ClickScope = Scope & {
  addEventListener(type: string, listener: (event: Clickish) => void, capture: boolean): void;
  removeEventListener(type: string, listener: (event: Clickish) => void, capture: boolean): void;
};
type Clickish = { target: unknown };

/** The slice of a MapLibre map this needs — same reason. */
export type AttributionHost = {
  getContainer(): ClickScope;
  on(type: string, listener: () => void): unknown;
  off(type: string, listener: () => void): unknown;
};

/**
 * Fold every expanded attribution control inside `root` back to its
 * badge. Returns how many were folded.
 */
export function collapseAttribution(root: Scope): number {
  const open = Array.from(root.querySelectorAll(EXPANDED_SELECTOR));
  for (const el of open) el.classList.remove(EXPANDED_CLASS);
  return open.length;
}

/**
 * Is this click the reader opening the credits themselves? Asked by
 * duck-typing rather than `instanceof Element`, which is wrong across
 * frames and undefined off the browser.
 */
export function isBadgeClick(target: unknown): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null;
  if (!el || typeof el.closest !== "function") return false;
  return el.closest(`.${BADGE_CLASS}`) != null;
}

/**
 * Keep `map`'s attribution folded to its badge until the reader opens
 * it. Returns the teardown to call when the map goes away.
 */
export function autoCollapseAttribution(map: AttributionHost): () => void {
  const container = map.getContainer();
  let readerOpened = false;

  const fold = () => {
    if (!readerOpened) collapseAttribution(container);
  };
  // Capture: this has to land whether or not MapLibre's own handler
  // stops the click on its way back up.
  const noteOpen = (event: Clickish) => {
    if (isBadgeClick(event.target)) readerOpened = true;
  };

  container.addEventListener("click", noteOpen, true);
  for (const type of SETTLE_EVENTS) map.on(type, fold);
  fold();

  return () => {
    container.removeEventListener("click", noteOpen, true);
    for (const type of SETTLE_EVENTS) map.off(type, fold);
  };
}
