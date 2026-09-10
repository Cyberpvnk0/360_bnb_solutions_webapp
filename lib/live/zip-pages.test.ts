import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pageInZip,
  readZipPages,
  readZipPagesStored,
  resetZipPagesMemory,
} from "./zip-pages";
import { RedfinError, fetchRedfinSearchRows } from "./redfin";
import { readKeyedBlob, writeKeyed } from "@/lib/db/market-store";

vi.mock("./redfin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./redfin")>()),
  fetchRedfinSearchRows: vi.fn(),
}));
vi.mock("@/lib/db/market-store", () => ({
  isFresh: () => true,
  readKeyedBlob: vi.fn(),
  writeKeyed: vi.fn(),
}));

const walk = vi.mocked(fetchRedfinSearchRows);
const stored = vi.mocked(readKeyedBlob);
const remember = vi.mocked(writeKeyed);

const ROWS = [
  { address: "1804 E Sitka St, Tampa, FL 33604", url: "/FL/Tampa/1804-E-Sitka-St-33604/home/47311661" },
  { address: "1806 E Sitka St Unit 2, Tampa, FL 33604", url: "/FL/Tampa/1806-E-Sitka-St-33604/unit-2/home/99" },
];
const answered = (
  raw: Record<string, unknown>[],
  over: Partial<Awaited<ReturnType<typeof fetchRedfinSearchRows>>> = {}
) => ({
  raw,
  body: { listing: raw },
  parsed: true,
  bytes: 1,
  credits: 10,
  pages: 1,
  morePages: false,
  failedPages: 0,
  ...over,
});

describe("a ZIP's rentals, keyed by address", () => {
  beforeEach(() => {
    resetZipPagesMemory();
    stored.mockResolvedValue(null);
    remember.mockResolvedValue({ ok: true, detail: null });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reads the site's search for the ZIP, keys it, and keeps it", async () => {
    walk.mockResolvedValue(answered(ROWS, { pages: 2 }));
    const read = await readZipPages("33604");
    expect(walk).toHaveBeenCalledWith("https://www.redfin.com/zipcode/33604/rentals", expect.any(Number));
    if (!read.ok) throw new Error(read.detail);
    expect(read.pages.from).toBe("site");
    expect(read.pages.rows).toBe(2);
    expect(read.pages.complete).toBe(true);
    // Whichever way the address is written.
    expect(pageInZip(read.pages, "1804 East Sitka Street")).toBe(
      "https://www.redfin.com/FL/Tampa/1804-E-Sitka-St-33604/home/47311661"
    );
    expect(pageInZip(read.pages, "1806 E Sitka St Apt 2")).toBe(
      "https://www.redfin.com/FL/Tampa/1806-E-Sitka-St-33604/unit-2/home/99"
    );
    expect(pageInZip(read.pages, "1806 E Sitka St")).toBeNull();
    expect(remember).toHaveBeenCalledWith(
      "zip-pages:v1:33604",
      expect.objectContaining({ pages: 2, complete: true })
    );
  });

  it("says when the ZIP was read in part", async () => {
    walk.mockResolvedValue(answered(ROWS, { pages: 10, morePages: true }));
    const read = await readZipPages("33604");
    expect(read.ok && read.pages.complete).toBe(false);
  });

  it("serves the stored rows without asking the site", async () => {
    stored.mockResolvedValue({
      value: {
        rows: [{ address: "1804 E Sitka St", sourceUrl: "https://www.redfin.com/FL/Tampa/x/home/1" }],
        pages: 1,
        complete: true,
      },
      at: new Date().toISOString(),
    });
    const read = await readZipPages("33604");
    expect(walk).not.toHaveBeenCalled();
    if (!read.ok) throw new Error(read.detail);
    expect(read.pages.from).toBe("store");
    expect(pageInZip(read.pages, "1804 E Sitka St")).toBe("https://www.redfin.com/FL/Tampa/x/home/1");
    expect(await readZipPagesStored("33604")).not.toBeNull();
  });

  it("tries the site's other URL shape when the first answers with no rows", async () => {
    walk
      .mockResolvedValueOnce(answered([], { body: { error: "x", message: "y" } }))
      .mockResolvedValueOnce(answered(ROWS));
    const read = await readZipPages("33604");
    expect(walk).toHaveBeenCalledTimes(2);
    expect(String(walk.mock.calls[1][0])).toBe("https://www.redfin.com/zipcode/33604/apartments-for-rent");
    expect(read.ok).toBe(true);
  });

  it("keeps nothing and says what came back when neither shape answers", async () => {
    walk
      .mockRejectedValueOnce(new RedfinError("http", 500, "Failed to scrape"))
      .mockResolvedValueOnce(answered([], { body: { error: "unsupported", message: "no" } }));
    const read = await readZipPages("33604");
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.detail).toBe(
      "rentals: http 500: Failed to scrape; apartments-for-rent: no rows, in an object with 2 keys: error, message"
    );
    expect(remember).not.toHaveBeenCalled();
  });

  it("stops at a throttle rather than spending the other shape on it", async () => {
    walk.mockRejectedValue(new RedfinError("quota", 429, "too many"));
    const read = await readZipPages("33604");
    expect(walk).toHaveBeenCalledTimes(1);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.detail).toBe("rentals: quota 429: too many");
  });

  it("does not ask again for a moment after a failure", async () => {
    walk.mockRejectedValue(new Error("network"));
    const first = await readZipPages("33604");
    const second = await readZipPages("33604");
    expect(walk).toHaveBeenCalledTimes(2); // both shapes, once
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.detail).toMatch(/not asked again yet/);
  });

  it("reads a ZIP once for two callers in the same moment", async () => {
    let release: (v: unknown) => void = () => {};
    walk.mockReturnValue(new Promise((r) => (release = r)) as never);
    const a = readZipPages("33604");
    const b = readZipPages("33604");
    await Promise.resolve();
    await Promise.resolve();
    release(answered(ROWS));
    await Promise.all([a, b]);
    expect(walk).toHaveBeenCalledTimes(1);
  });

  it("refuses anything but five digits", async () => {
    expect((await readZipPages("3360")).ok).toBe(false);
    expect(await readZipPagesStored("abcde")).toBeNull();
    expect(walk).not.toHaveBeenCalled();
  });
});
