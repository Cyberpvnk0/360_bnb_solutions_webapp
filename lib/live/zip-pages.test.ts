import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageInZip, readZipPages, readZipPagesStored } from "./zip-pages";
import { fetchRedfinSearchRows } from "./redfin";
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

describe("a ZIP's rentals, keyed by address", () => {
  beforeEach(() => {
    stored.mockResolvedValue(null);
    remember.mockResolvedValue({ ok: true, detail: null });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reads the site's search for the ZIP, keys it, and keeps it", async () => {
    walk.mockResolvedValue({
      raw: ROWS,
      body: {},
      parsed: true,
      bytes: 1,
      credits: 10,
      pages: 2,
      morePages: false,
      failedPages: 0,
    });
    const pages = await readZipPages("33604");
    expect(walk).toHaveBeenCalledWith("https://www.redfin.com/zipcode/33604/rentals", expect.any(Number));
    expect(pages?.from).toBe("site");
    expect(pages?.rows).toBe(2);
    expect(pages?.complete).toBe(true);
    // Whichever way the address is written.
    expect(pageInZip(pages!, "1804 East Sitka Street")).toBe(
      "https://www.redfin.com/FL/Tampa/1804-E-Sitka-St-33604/home/47311661"
    );
    expect(pageInZip(pages!, "1806 E Sitka St Apt 2")).toBe(
      "https://www.redfin.com/FL/Tampa/1806-E-Sitka-St-33604/unit-2/home/99"
    );
    expect(pageInZip(pages!, "1806 E Sitka St")).toBeNull();
    expect(remember).toHaveBeenCalledWith(
      "zip-pages:v1:33604",
      expect.objectContaining({ pages: 2, complete: true })
    );
  });

  it("says when the ZIP was read in part", async () => {
    walk.mockResolvedValue({
      raw: ROWS,
      body: {},
      parsed: true,
      bytes: 1,
      credits: 10,
      pages: 10,
      morePages: true,
      failedPages: 0,
    });
    const pages = await readZipPages("33604");
    expect(pages?.complete).toBe(false);
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
    const pages = await readZipPages("33604");
    expect(walk).not.toHaveBeenCalled();
    expect(pages?.from).toBe("store");
    expect(pageInZip(pages!, "1804 E Sitka St")).toBe("https://www.redfin.com/FL/Tampa/x/home/1");
    expect(await readZipPagesStored("33604")).not.toBeNull();
  });

  it("keeps nothing when the site could not be read, and answers null", async () => {
    walk.mockRejectedValue(new Error("network"));
    expect(await readZipPages("33604")).toBeNull();
    expect(remember).not.toHaveBeenCalled();
    walk.mockResolvedValue({
      raw: [],
      body: null,
      parsed: false,
      bytes: 0,
      credits: null,
      pages: 1,
      morePages: false,
      failedPages: 0,
    });
    expect(await readZipPages("33604")).toBeNull();
    expect(remember).not.toHaveBeenCalled();
  });

  it("reads a ZIP once for two callers in the same moment", async () => {
    let release: (v: unknown) => void = () => {};
    walk.mockReturnValue(new Promise((r) => (release = r)) as never);
    const a = readZipPages("33604");
    const b = readZipPages("33604");
    await Promise.resolve();
    await Promise.resolve();
    release({ raw: ROWS, body: {}, parsed: true, bytes: 1, credits: 10, pages: 1, morePages: false, failedPages: 0 });
    await Promise.all([a, b]);
    expect(walk).toHaveBeenCalledTimes(1);
  });

  it("refuses anything but five digits", async () => {
    expect(await readZipPages("3360")).toBeNull();
    expect(await readZipPagesStored("abcde")).toBeNull();
    expect(walk).not.toHaveBeenCalled();
  });
});
