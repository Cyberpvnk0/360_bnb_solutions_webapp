import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkZillow } from "./zillow-page";

const TAMPA = { address: "1107 W Arch St Apt A", city: "Tampa", stateCode: "FL", zip: "33607" };
const fetchMock = vi.fn();

const redirect = (status: number, location: string) => new Response(null, { status, headers: { location } });

describe("asking Zillow whether it has the home", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks the address page without following it, and reads the home off the redirect", async () => {
    fetchMock.mockResolvedValue(redirect(301, "/homedetails/1107-W-Arch-St-APT-A-Tampa-FL-33607/44816642_zpid/?from=search"));
    const out = await checkZillow(TAMPA);
    expect(out).toEqual({
      kind: "page",
      url: "https://www.zillow.com/homedetails/1107-W-Arch-St-APT-A-Tampa-FL-33607/44816642_zpid/",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://www.zillow.com/homes/1107-W-Arch-St-APT-A-Tampa-FL-33607_rb/");
    expect(init.redirect).toBe("manual");
  });

  it("reads a redirect to a search as no such home", async () => {
    fetchMock.mockResolvedValue(redirect(302, "https://www.zillow.com/tampa-fl/rentals/?searchQueryState=x"));
    expect(await checkZillow(TAMPA)).toMatchObject({ kind: "none" });
  });

  it("says nothing when Zillow would not say: a refusal, a challenge, another site, silence", async () => {
    fetchMock.mockResolvedValue(new Response("denied", { status: 403 }));
    expect(await checkZillow(TAMPA)).toMatchObject({ kind: "unknown", detail: "HTTP 403" });
    fetchMock.mockResolvedValue(new Response("<html>search</html>", { status: 200 }));
    expect(await checkZillow(TAMPA)).toMatchObject({ kind: "unknown" });
    fetchMock.mockResolvedValue(redirect(302, "https://www.zillow.com/captchaPerimeterX/?url=x"));
    expect(await checkZillow(TAMPA)).toMatchObject({ kind: "unknown" });
    fetchMock.mockResolvedValue(redirect(302, "https://evil.example/homedetails/x"));
    expect(await checkZillow(TAMPA)).toMatchObject({ kind: "unknown" });
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValue(timeout);
    expect(await checkZillow(TAMPA)).toEqual({ kind: "unknown", detail: "no answer in time" });
  });

  it("has nothing to ask about half an address", async () => {
    expect(await checkZillow({ ...TAMPA, city: "" })).toMatchObject({ kind: "unknown" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
