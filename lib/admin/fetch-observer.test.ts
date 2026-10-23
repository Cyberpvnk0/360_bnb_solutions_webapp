import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The observer wraps the global fetch for the whole server, so it is
 * held to one rule above the rest: the call it watches must behave
 * exactly as if it were not there.
 */

const recordCall = vi.fn();
vi.mock("./telemetry", () => ({ recordCall: (...a: unknown[]) => recordCall(...a) }));

import { installFetchObserver } from "./fetch-observer";
import { asProbe } from "./probe-scope";

const INSTALLED = Symbol.for("aircore.fetchObserver");
type G = typeof globalThis & { [INSTALLED]?: true };
const realFetch = globalThis.fetch;
let inner: ReturnType<typeof vi.fn>;

beforeEach(() => {
  recordCall.mockClear();
  inner = vi.fn(async () => new Response("body", { status: 201 }));
  globalThis.fetch = inner as unknown as typeof fetch;
  delete (globalThis as G)[INSTALLED];
  installFetchObserver();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as G)[INSTALLED];
});

describe("installFetchObserver", () => {
  it("records a vendor call and hands back the untouched response", async () => {
    const init = { method: "POST", body: "x" };
    const res = await fetch("https://api.rentcast.io/v1/listings?key=secret", init);
    expect(await res.text()).toBe("body");
    expect(inner).toHaveBeenCalledWith("https://api.rentcast.io/v1/listings?key=secret", init);
    expect(recordCall).toHaveBeenCalledTimes(1);
    expect(recordCall.mock.calls[0][0]).toBe("rentcast");
    expect(recordCall.mock.calls[0][1]).toBe(201);
    expect(JSON.stringify(recordCall.mock.calls[0])).not.toContain("secret");
  });

  it("ignores every host that is not a vendor", async () => {
    await fetch("https://abcdefghijklmnopqrst.supabase.co/rest/v1/x");
    await fetch(new URL("https://example.com/"));
    expect(recordCall).not.toHaveBeenCalled();
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("reads the URL from a Request object", async () => {
    await fetch(new Request("https://api.airroi.com/markets/summary"));
    expect(recordCall.mock.calls[0][0]).toBe("airroi");
  });

  it("records a failure with no status and re-throws it unchanged", async () => {
    const boom = new TypeError("fetch failed");
    inner.mockRejectedValueOnce(boom);
    await expect(fetch("https://api.airroi.com/x")).rejects.toBe(boom);
    expect(recordCall.mock.calls[0][1]).toBeNull();
  });

  it("leaves a health probe's own requests out of the record", async () => {
    await asProbe(() => fetch("https://maps.googleapis.com/maps/api/streetview/metadata"));
    expect(recordCall).not.toHaveBeenCalled();
    await fetch("https://maps.googleapis.com/maps/api/streetview/metadata");
    expect(recordCall).toHaveBeenCalledTimes(1);
  });

  it("installs once", async () => {
    const wrapped = globalThis.fetch;
    installFetchObserver();
    expect(globalThis.fetch).toBe(wrapped);
    await fetch("https://api.rentcast.io/");
    expect(recordCall).toHaveBeenCalledTimes(1);
  });
});
