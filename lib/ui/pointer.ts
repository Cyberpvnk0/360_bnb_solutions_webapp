/**
 * Whether this device is driven by a finger or by a cursor, and what to
 * call the gesture.
 *
 * WHY A ROW NEEDS TO SAY SO. Several rows in this product are buttons
 * that spend money — a market row runs an analysis, an area row buys a
 * ZIP's figures for two credits. On a desktop a pill slides in on hover
 * and says as much. A finger has no hover, so on a phone those rows
 * looked like ordinary table rows and charged real credits when tapped:
 * the affordance was there for everybody who did not need it and gone
 * for everybody who did.
 *
 * So the pill is hover-revealed on a cursor and simply always there on
 * a touch screen, and it names the gesture the reader actually has.
 */

/**
 * The media query for "this pointer can hover and is precise".
 *
 * Asked of the POINTER, never of the screen's width — a 13-inch tablet
 * is a touch device and a small window on a laptop is not, and a width
 * breakpoint gets both backwards. `any-hover` rather than `hover` so a
 * laptop with a touchscreen, which reports a coarse primary pointer,
 * still counts as a cursor machine.
 */
export const FINE_POINTER = "(any-hover: hover) and (any-pointer: fine)";

/** What the reader does to a row, in their own gesture. */
export function verbFor(fine: boolean): "Click" | "Tap" {
  return fine ? "Click" : "Tap";
}

/** "Click to Analyze" / "Tap to Analyze". */
export function actionLabel(fine: boolean, action: string): string {
  return `${verbFor(fine)} to ${action}`;
}
