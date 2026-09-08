/**
 * Data access layer.
 *
 * Components import ONLY from lib/data — never from lib/mock directly.
 * User data (deals, landlords, activity, the session itself) lives in
 * per-user tables and is loaded by the session provider through
 * lib/db/user-data — nothing seeded stands in for it. What remains here
 * is the catalogue: markets, submarkets, and the preview inventory the
 * Free plan browses.
 */

export * from "./markets";
export * from "./submarkets";
export * from "./rentals";
export * from "./analyses";
export * from "./latency";
