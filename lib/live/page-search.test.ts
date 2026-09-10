import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linksInDuckHtml, linksInRss, pageSearchQuery, searchListingPages } from "./page-search";

const TAMPA = { address: "1107 W Arch St Apt A", city: "Tampa", stateCode: "FL" };

describe("the query put to the engines", () => {
  it("quotes the house number and the street's name, scoped to the site", () => {
    expect(pageSearchQuery({ ...TAMPA, address: "1804 East Sitka Street" })).toBe('site:redfin.com "1804" "Sitka" Tampa FL');
    expect(pageSearchQuery(TAMPA)).toBe('site:redfin.com "1107" "Arch" Tampa FL');
    expect(pageSearchQuery({ ...TAMPA, address: "The Palms" })).toBe('site:redfin.com "The Palms" Tampa FL');
    expect(pageSearchQuery({ ...TAMPA, city: "" })).toBeNull();
  });
});

describe("reading the engines' answers", () => {
  it("takes the links out of Bing's feed, CDATA or not", () => {
    const xml = `<rss><channel><item><title>x</title><link>https://www.redfin.com/FL/Tampa/1107-W-Arch-St-33607/unit-A/home/1</link></item>
      <item><link><![CDATA[https://www.redfin.com/FL/Tampa/1107-W-Arch-St-33607/apartment/2?x=1]]></link></item>
      <item><link>https://www.zillow.com/x</link></item></channel></rss>`;
    expect(linksInRss(xml)).toEqual([
      "https://www.redfin.com/FL/Tampa/1107-W-Arch-St-33607/unit-A/home/1",
      "https://www.redfin.com/FL/Tampa/1107-W-Arch-St-33607/apartment/2?x=1",
      "https://www.zillow.com/x",
    ]);
  });

  it("takes the links out of DuckDuckGo's HTML, unwrapping their redirect", () => {
    const html = `<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.redfin.com%2FFL%2FTampa%2F1107-W-Arch-St-33607%2Fhome%2F1&amp;rut=abc">1107 W Arch St</a>
      <a class="result__a" href="https://www.redfin.com/FL/Tampa/1107-W-Arch-St-33607/unit-A/home/3">unit A</a>
      <a class="result__snippet" href="https://example.com/not-a-result">x</a>`;
    expect(linksInDuckHtml(html)).toEqual([
      "https://www.redfin.com/FL/Tampa/1107-W-Arch-St-33607/home/1",
      "https://www.redfin.com/FL/Tampa/1107-W-Arch-St-33607/unit-A/home/3",
    ]);
  });
});

describe("asking the engines", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  const bingFeed = `<rss><channel><item><link>https://www.redfin.com/FL/Tampa/1107-W-Arch-St-33607/unit-A/home/1</link></item><item><link>https://www.redfin.com/city/1/FL/Tampa</link></item></channel></rss>`;
  const duckHtml = `<a class="result__a" href="https://www.redfin.com/FL/Tampa/1107-W-Arch-St-33607/home/9?utm=1">x</a>`;

  it("asks both at once, keeps only property pages, and puts Bing's first", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      new Response(url.includes("bing.com") ? bingFeed : duckHtml, { status: 200 })
    );
    const out = await searchListingPages(TAMPA);
    expect(out.urls).toEqual([
      "https://www.redfin.com/FL/Tampa/1107-W-Arch-St-33607/unit-A/home/1",
      "https://www.redfin.com/FL/Tampa/1107-W-Arch-St-33607/home/9",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.startsWith("https://www.bing.com/search?q=") && u.endsWith("&format=rss"))).toBe(true);
    expect(urls.some((u) => u.startsWith("https://html.duckduckgo.com/html/?q="))).toBe(true);
    expect(decodeURIComponent(urls[0])).toContain('site:redfin.com "1107" "Arch" Tampa FL');
  });

  it("carries on when one engine refuses or is silent, and says so", async () => {
    const timeout = new Error("t");
    timeout.name = "TimeoutError";
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("bing.com")) throw timeout;
      return new Response(duckHtml, { status: 200 });
    });
    const out = await searchListingPages(TAMPA);
    expect(out.urls).toEqual(["https://www.redfin.com/FL/Tampa/1107-W-Arch-St-33607/home/9"]);
    expect(out.detail).toContain("bing: no answer in time");
    fetchMock.mockResolvedValue(new Response("denied", { status: 403 }));
    expect(await searchListingPages(TAMPA)).toEqual({ urls: [], detail: "bing: HTTP 403; duckduckgo: HTTP 403" });
  });

  it("asks nothing for half an address", async () => {
    expect((await searchListingPages({ ...TAMPA, city: "" })).urls).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
