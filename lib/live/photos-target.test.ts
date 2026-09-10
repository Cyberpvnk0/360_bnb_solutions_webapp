import { beforeEach, describe, expect, it, vi } from "vitest";
import { photosTarget } from "./photos-target";
import { resolveListingPage } from "./redfin-page";
import { checkZillow } from "./zillow-page";

vi.mock("./redfin-page", () => ({ resolveListingPage: vi.fn() }));
vi.mock("./zillow-page", () => ({ checkZillow: vi.fn() }));

const redfin = vi.mocked(resolveListingPage);
const zillow = vi.mocked(checkZillow);
const TAMPA = { address: "1107 W Arch St Apt A", city: "Tampa", stateCode: "FL", zip: "33607" };
const PAGE = "https://www.redfin.com/FL/Tampa/1107-W-Arch-St-33607/unit-A/home/1";
const HOME = "https://www.zillow.com/homedetails/x/1_zpid/";

describe("where a View photos click lands", () => {
  beforeEach(() => {
    redfin.mockReset();
    zillow.mockReset();
    redfin.mockResolvedValue({ url: null, answered: false, detail: "33607: 40 rentals, none at this address" });
    zillow.mockResolvedValue({ kind: "unknown", detail: "HTTP 403" });
  });

  it("opens the listing's own page first, asked the fast way", async () => {
    redfin.mockResolvedValue({ url: PAGE, answered: true, detail: null });
    zillow.mockResolvedValue({ kind: "page", url: HOME });
    expect(await photosTarget(TAMPA)).toMatchObject({ href: PAGE, source: "redfin", verified: true });
    expect(redfin.mock.calls[0][1]).toEqual({ fast: true });
  });

  it("then Zillow's page for the home, when Zillow says it has one", async () => {
    zillow.mockResolvedValue({ kind: "page", url: HOME });
    expect(await photosTarget(TAMPA)).toMatchObject({ href: HOME, source: "zillow", verified: true });
  });

  it("then pictures of the address on Google, when Zillow said it has no such home", async () => {
    zillow.mockResolvedValue({ kind: "none", detail: "redirected to a search (302)" });
    const out = await photosTarget(TAMPA);
    expect(out).toMatchObject({ source: "google", verified: false });
    const url = new URL(out!.href);
    expect(url.searchParams.get("tbm")).toBe("isch");
    expect(url.searchParams.get("q")).toBe("1107 W Arch St Apt A, Tampa, FL 33607");
  });

  it("opens Zillow's address page when Zillow could not be asked", async () => {
    const out = await photosTarget(TAMPA);
    expect(out).toMatchObject({
      href: "https://www.zillow.com/homes/1107-W-Arch-St-APT-A-Tampa-FL-33607_rb/",
      source: "zillow",
      verified: false,
    });
    expect(out!.detail).toContain("zillow: unknown (HTTP 403)");
  });

  it("has nowhere to send half an address", async () => {
    expect(await photosTarget({ ...TAMPA, city: "" })).toBeNull();
    expect(redfin).not.toHaveBeenCalled();
  });
});
