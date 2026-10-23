/**
 * Sees every server-side call to a known vendor, and touches nothing.
 *
 * Installed once per server instance from instrumentation.ts. It wraps
 * the global fetch so that a request to a host in lib/admin/services is
 * timed and its status recorded (lib/admin/telemetry). Every other
 * request — our own store, our own routes, any host not listed — goes
 * straight through without so much as a clock read.
 *
 * WHY HERE AND NOT IN EACH VENDOR MODULE. There are a dozen call sites
 * across the vendor modules, and a health panel that depends on every
 * one of them remembering to report is a panel that goes quiet the day
 * somebody adds a thirteenth. Wrapping fetch catches all of them,
 * including the ones not written yet.
 *
 * WHAT IT NEVER DOES: read a body (the stream belongs to the caller),
 * keep a URL (keys travel in query strings), change a request, or
 * change a response. A failure inside the observer is swallowed by
 * recordCall; a failure of the request itself is re-thrown untouched.
 *
 * Framework data-cache hits are answered before they reach this
 * wrapper, which is right: a cache hit is not a call to the vendor.
 */

import { inProbe } from "./probe-scope";
import { serviceForUrl } from "./services";
import { recordCall } from "./telemetry";

const INSTALLED = Symbol.for("aircore.fetchObserver");

type Marked = typeof globalThis & { [INSTALLED]?: true };

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function installFetchObserver(): void {
  const g = globalThis as Marked;
  if (g[INSTALLED]) return;
  const original = g.fetch;
  if (typeof original !== "function") return;

  const observed = async function fetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    let service: ReturnType<typeof serviceForUrl> = null;
    try {
      // A health probe's own request is not product traffic.
      service = inProbe() ? null : serviceForUrl(urlOf(input));
    } catch {
      service = null;
    }
    if (!service) return original(input, init);

    const started = performance.now();
    try {
      const res = await original(input, init);
      recordCall(service, res.status, performance.now() - started);
      return res;
    } catch (error) {
      // No response at all: refused, reset, or timed out — including a
      // timeout the caller set. Either way the vendor did not answer.
      recordCall(service, null, performance.now() - started);
      throw error;
    }
  };

  g.fetch = observed as typeof fetch;
  g[INSTALLED] = true;
}
