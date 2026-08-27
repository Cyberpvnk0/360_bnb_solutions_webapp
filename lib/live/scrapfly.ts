/**
 * Scrapfly, as a plain fetch.
 *
 * A second scraping vendor beside the first, added because the first
 * one's trial ran dry and because a comparison needs something to
 * compare with. Same posture as every other vendor here: no SDK, key
 * from server-only env, schema-tolerant reading of whatever comes back.
 *
 * Deliberately thin. It exists to answer "what does this URL return",
 * which is all the source comparison needs, and adding more before
 * anything uses it would be inventing requirements.
 */

import { withScraperSlot } from "@/lib/live/limit";

const ENDPOINT = "https://api.scrapfly.io/scrape";

/** A day, matching the other vendor: the same page twice in one day is
 *  the same page, and paying twice for it is a choice. */
const REVALIDATE_SECONDS = 86_400;

const TIMEOUT_MS = 45_000;

export function hasScrapflyKey(): boolean {
  return Boolean(process.env.SCRAPFLY_SECRET_KEY ?? process.env.SCRAPFLY_KEY);
}

export interface ScrapflyPage {
  ok: boolean;
  status: number;
  /** The page body, whatever format it came back as. */
  content: string;
  bytes: number;
  /** What the vendor says it billed, when it says. */
  credits: number | null;
  /** The failure in words, when there was one. */
  error: string | null;
}

/**
 * One page through Scrapfly.
 *
 * `asp` is their anti-scraping bypass and costs more than a plain
 * fetch — but the sites this is pointed at are exactly the ones that
 * need it, and a cheap request that returns a block page is not
 * cheaper than an expensive one that returns the page.
 */
export async function scrapflyPage(
  url: string,
  opts: { renderJs?: boolean; asp?: boolean } = {}
): Promise<ScrapflyPage> {
  const key = process.env.SCRAPFLY_SECRET_KEY ?? process.env.SCRAPFLY_KEY;
  const miss: ScrapflyPage = {
    ok: false,
    status: 0,
    content: "",
    bytes: 0,
    credits: null,
    error: null,
  };
  if (!key) return { ...miss, error: "no SCRAPFLY_SECRET_KEY" };

  const params = new URLSearchParams({
    key,
    url,
    asp: opts.asp === false ? "false" : "true",
    format: "raw",
  });
  if (opts.renderJs) params.set("render_js", "true");

  let res: Response;
  try {
    res = await withScraperSlot(() =>
      fetch(`${ENDPOINT}?${params}`, {
        next: { revalidate: REVALIDATE_SECONDS },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    );
  } catch {
    return { ...miss, error: "network or timeout" };
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return {
      ...miss,
      status: res.status,
      bytes: text.length,
      error: text.replace(/\s+/g, " ").slice(0, 200),
    };
  }

  // format=raw returns the page itself; anything else arrives wrapped.
  // Read both rather than assume, because assuming a vendor's response
  // shape is how a whole afternoon went last time.
  let content = text;
  let credits: number | null = null;
  if (text.startsWith("{")) {
    try {
      const body = JSON.parse(text) as {
        result?: { content?: unknown };
        context?: { cost?: unknown };
      };
      if (typeof body.result?.content === "string") content = body.result.content;
      if (typeof body.context?.cost === "number") credits = body.context.cost;
    } catch {
      // Not JSON after all — the raw body is the answer.
    }
  }
  const header = res.headers.get("x-scrapfly-api-cost");
  if (credits === null && header !== null && Number.isFinite(Number(header))) {
    credits = Number(header);
  }

  return {
    ok: true,
    status: res.status,
    content,
    bytes: content.length,
    credits,
    error: null,
  };
}
