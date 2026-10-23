/**
 * Server start-up hooks (Next.js instrumentation).
 *
 * Two things, both feeding the admin panel's System health tab:
 *
 *   register        installs the fetch observer, which records the
 *                   status and latency of every call to a known vendor
 *   onRequestError  records server errors thrown by our own routes,
 *                   pages and actions, sanitised, so "is the backend
 *                   healthy" has an answer beyond "the page loaded"
 *
 * Node.js runtime only: both write to the shared store, and the edge
 * runtime runs none of the routes that call vendors.
 */

import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installFetchObserver } = await import("@/lib/admin/fetch-observer");
  installFetchObserver();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordRouteError } = await import("@/lib/admin/telemetry");
  recordRouteError({
    path: request.path,
    method: request.method,
    kind: context.routeType,
    error,
  });
};
