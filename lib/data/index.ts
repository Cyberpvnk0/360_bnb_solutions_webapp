/**
 * Data access layer.
 *
 * Components import ONLY from lib/data — never from lib/mock directly.
 * Today every function resolves mock data behind a small artificial delay
 * (so loading skeletons are real); when live APIs arrive, swap the bodies
 * here and no component changes.
 */

export * from "./markets";
export * from "./submarkets";
export * from "./analyses";
export * from "./deals";
export * from "./landlords";
export * from "./session";
export * from "./admin";
export * from "./latency";
