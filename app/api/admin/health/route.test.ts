import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The route that says which keys this deployment holds and which
 * vendors are refusing it. What matters is who it refuses.
 */

let gateAnswer: { ok: boolean; response?: Response; user?: unknown } = { ok: true, user: {} };
vi.mock("@/lib/auth/gate", () => ({
  requireAccountAdmin: vi.fn(async () => gateAnswer),
}));

const buildHealthReport = vi.fn(async () => ({ checkedAt: "now", services: [] }));
vi.mock("@/lib/admin/health", () => ({
  buildHealthReport: () => buildHealthReport(),
}));

import { GET } from "./route";

beforeEach(() => {
  buildHealthReport.mockClear();
});

describe("GET /api/admin/health", () => {
  it("runs no check at all for anyone the admin gate turns away", async () => {
    gateAnswer = { ok: false, response: Response.json({ reason: "admin-only" }, { status: 403 }) };
    const res = await GET();
    expect(res.status).toBe(403);
    expect(buildHealthReport).not.toHaveBeenCalled();
  });

  it("answers a named admin, uncached", async () => {
    gateAnswer = { ok: true, user: {} };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ checkedAt: "now", services: [] });
  });
});
