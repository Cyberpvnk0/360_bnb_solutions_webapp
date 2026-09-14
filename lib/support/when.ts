/**
 * How long ago, in words.
 *
 * A support queue is read by scanning for what has been waiting
 * longest, and "3 days" answers that in a glance where a timestamp
 * does not. Pure and injectable so the tests are not a function of the
 * day they run.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function timeAgo(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "—";
  const delta = now - at;
  // A clock a little ahead of the server reads as the future; "just
  // now" is the honest answer, not "in -2 minutes".
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) {
    const m = Math.floor(delta / MINUTE);
    return `${m}m ago`;
  }
  if (delta < DAY) {
    const h = Math.floor(delta / HOUR);
    return `${h}h ago`;
  }
  if (delta < WEEK) {
    const d = Math.floor(delta / DAY);
    return `${d}d ago`;
  }
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: now - at > 300 * DAY ? "numeric" : undefined,
  });
}

/** The full stamp, for a title attribute — the exact answer is one
 *  hover away rather than gone. */
export function fullWhen(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  return new Date(at).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
