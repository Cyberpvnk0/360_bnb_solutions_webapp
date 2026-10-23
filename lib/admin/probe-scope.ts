/**
 * Marks a health probe's own requests, so the fetch observer leaves
 * them out of the "last real calls" record.
 *
 * Without this, a successful probe of Google's Street View metadata
 * would land in the same window as the product's Street View calls and
 * paint a failing feature green. AsyncLocalStorage carries the mark
 * through every await — including requests an SDK makes on our behalf
 * — without touching a header or a URL.
 *
 * Node.js only, like everything that imports it.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const scope = new AsyncLocalStorage<true>();

export function asProbe<T>(fn: () => Promise<T>): Promise<T> {
  return scope.run(true, fn);
}

export function inProbe(): boolean {
  return scope.getStore() === true;
}
