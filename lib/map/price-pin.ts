/**
 * A price pin for a MapLibre map: the red pill with the tail (styled
 * under .rental-pin in globals.css) inside a plain wrapper that
 * MapLibre positions. Used by the Deal Finder map and the comps map,
 * so the two feel the same under the pointer.
 *
 * TWO ELEMENTS, ON PURPOSE. MapLibre places a marker by writing an
 * inline transform on the element it is handed, and every state of the
 * pill — the hover lift, the press, the selected ring, the spring on
 * release — is a transform too. On one element they fought: the
 * inline position beat the stylesheet's hover scale, so pins never
 * grew; and the release animation beat the inline position, so a
 * clicked pin leapt to the map's corner and slid back into place. The
 * wrapper carries the position and nothing else; the pill carries
 * every motion.
 *
 * Client-only: builds DOM.
 */

export interface PricePin {
  /** Hand this to MapLibre. Stacking (z-index) belongs here. */
  marker: HTMLDivElement;
  /** The pill: state classes (is-hot, is-selected) go here. */
  pin: HTMLButtonElement;
}

export function createPricePin(opts: {
  label: string;
  ariaLabel: string;
  /** Data attributes for the pill, e.g. { compId } → data-comp-id. */
  dataset?: Record<string, string>;
  onHover: (hot: boolean) => void;
  onClick: () => void;
}): PricePin {
  const marker = document.createElement("div");
  marker.className = "rental-marker";

  const pin = document.createElement("button");
  pin.type = "button";
  pin.className = "rental-pin";
  pin.textContent = opts.label;
  pin.setAttribute("aria-label", opts.ariaLabel);
  for (const [k, v] of Object.entries(opts.dataset ?? {})) pin.dataset[k] = v;

  pin.addEventListener("mouseenter", () => opts.onHover(true));
  pin.addEventListener("mouseleave", () => opts.onHover(false));

  // The press is a real motion, not just :active — a quick click never
  // holds the button long enough for :active to be seen — so the pin
  // sinks on pointerdown and springs back on release with an
  // overshoot, the way a physical key does.
  pin.addEventListener("pointerdown", () => pin.classList.add("is-pressed"));
  const release = () => {
    if (!pin.classList.contains("is-pressed")) return;
    pin.classList.remove("is-pressed");
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    pin.animate(
      [
        { transform: "scale(0.94) translateY(1px)" },
        { transform: "scale(1.18)", offset: 0.6 },
        { transform: "" },
      ],
      { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
    );
  };
  pin.addEventListener("pointerup", release);
  pin.addEventListener("pointerleave", release);
  pin.addEventListener("pointercancel", release);

  pin.addEventListener("click", (ev) => {
    // The map's own click clears the selection; this one makes it.
    ev.stopPropagation();
    opts.onClick();
  });

  marker.appendChild(pin);
  return { marker, pin };
}
