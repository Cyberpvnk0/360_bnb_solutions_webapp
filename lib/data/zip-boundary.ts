/**
 * Client access to a ZIP's outline for the map. Remembered for the
 * session: the same ZIP re-searched draws at once.
 */

import { isZipBoundary, type ZipBoundary } from "@/lib/map/zip-boundary";

const known = new Map<string, Promise<ZipBoundary | null>>();

/** The outline, or null when there is none to draw. Never throws. */
export function getZipBoundary(zip: string): Promise<ZipBoundary | null> {
  const hit = known.get(zip);
  if (hit) return hit;
  const pending = (async () => {
    try {
      const res = await fetch(`/api/zip-boundary?zip=${encodeURIComponent(zip)}`);
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; boundary?: unknown }
        | null;
      return res.ok && data?.ok && isZipBoundary(data.boundary) ? data.boundary : null;
    } catch {
      return null;
    }
  })();
  known.set(zip, pending);
  // A miss is not remembered: the service may simply have been slow.
  void pending.then((b) => {
    if (!b) known.delete(zip);
  });
  return pending;
}
