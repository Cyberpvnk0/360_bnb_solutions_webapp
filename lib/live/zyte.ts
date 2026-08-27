/**
 * Zyte API, as a plain fetch.
 *
 * The third scraping vendor measured here, and the one with a
 * genuinely different offer: automatic extraction that turns a page
 * into structured JSON without anyone having written an endpoint for
 * that specific site. Its supported types are product, productList,
 * article and jobPosting — no real-estate type — but a rental search
 * page IS a grid of things with a name, a price and photos, so
 * productList may read one anyway.
 *
 * That is the whole question worth asking of Zyte. A structured
 * endpoint exists for Redfin elsewhere at 1 credit; none exists for
 * Realtor anywhere, which is what has kept the better photos and the
 * working furnished filter out of reach.
 *
 * Same posture as the others: no SDK, key from server-only env,
 * tolerant reading of whatever comes back.
 */

import { withScraperSlot } from "@/lib/live/limit";

const ENDPOINT = "https://api.zyte.com/v1/extract";
const REVALIDATE_SECONDS = 86_400;

/**
 * Short on purpose. Six of these run in sequence inside a route capped
 * at five minutes, so a per-request ceiling that looks generous alone
 * is what makes the whole probe die with nothing to show.
 */
const TIMEOUT_MS = 45_000;

/** Every spelling this key might have been saved under. Names are
 *  cheap; a silent miss because the variable was called something
 *  reasonable-but-different costs an afternoon. */
const KEY_NAMES = [
  "ZYTE_API_KEY",
  "ZYTE_API_SECRET_KEY",
  "ZYTE_SECRET_KEY",
  "ZYTE_KEY",
] as const;

function zyteKey(): string | null {
  for (const name of KEY_NAMES) {
    const value = process.env[name];
    if (value) return value;
  }
  return null;
}

export function hasZyteKey(): boolean {
  return zyteKey() !== null;
}

/** Which ZYTE_* names this deployment can see. Names only, never
 *  values — a diagnostic that prints a key is worse than the confusion
 *  it clears up. */
export function zyteKeyNamesSeen(): string[] {
  return Object.keys(process.env)
    .filter((k) => /^ZYTE/i.test(k))
    .sort();
}

export function zyteKeyMissingMessage(): string {
  return `no Zyte key. Looked for ${KEY_NAMES.join(", ")}; this deployment has ${
    zyteKeyNamesSeen().join(", ") || "no ZYTE_* variables at all"
  }`;
}

export type ZyteMode = "http" | "browser" | "productList";

export interface ZyteProduct {
  name?: string;
  price?: string;
  /** How many photos the extractor found for this one listing. */
  images: number;
}

export interface ZytePage {
  ok: boolean;
  status: number;
  /** The page HTML, however it was obtained. */
  content: string;
  bytes: number;
  /** Structured products, when productList extraction was asked for.
   *  `null` means it wasn't asked for; `[]` means it was and came back
   *  empty, which is a different and much more interesting answer. */
  products: ZyteProduct[] | null;
  /** Anything the vendor said about what this cost. */
  cost: string | null;
  error: string | null;
}

export async function zytePage(
  url: string,
  mode: ZyteMode = "http"
): Promise<ZytePage> {
  const key = zyteKey();
  const miss: ZytePage = {
    ok: false,
    status: 0,
    content: "",
    bytes: 0,
    products: null,
    cost: null,
    error: null,
  };
  if (!key) return { ...miss, error: zyteKeyMissingMessage() };

  // Basic auth, key as the username and no password — their scheme.
  const auth = Buffer.from(`${key}:`).toString("base64");
  const body: Record<string, unknown> = { url };
  if (mode === "productList") {
    // Ask for the page as well as the extraction. An empty extraction
    // over good HTML is a completely different finding from a page
    // that never loaded, and only having both tells them apart — it is
    // also what lets the totals patterns still read the raw page.
    body.productList = true;
    body.productListOptions = { extractFrom: "httpResponseBody" };
    body.httpResponseBody = true;
  } else if (mode === "browser") {
    body.browserHtml = true;
  } else {
    body.httpResponseBody = true;
  }

  let res: Response;
  try {
    res = await withScraperSlot(() =>
      fetch(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
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
      error: text.replace(/\s+/g, " ").slice(0, 240),
    };
  }

  let parsed: {
    httpResponseBody?: string;
    browserHtml?: string;
    productList?: { products?: unknown[] };
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...miss, status: res.status, bytes: text.length, error: "not JSON" };
  }

  // httpResponseBody arrives base64; browserHtml arrives as text.
  let content = "";
  if (typeof parsed.browserHtml === "string") {
    content = parsed.browserHtml;
  } else if (typeof parsed.httpResponseBody === "string") {
    content = Buffer.from(parsed.httpResponseBody, "base64").toString("utf8");
  }

  const raw = parsed.productList?.products;
  const products = Array.isArray(raw)
    ? raw.slice(0, 200).map((p) => {
        const item = p as {
          name?: unknown;
          price?: unknown;
          images?: unknown;
          mainImage?: unknown;
        };
        const gallery = Array.isArray(item.images) ? item.images.length : 0;
        return {
          name: typeof item.name === "string" ? item.name.slice(0, 60) : undefined,
          price: typeof item.price === "string" ? item.price : undefined,
          // The number that decides this whole comparison.
          images: gallery || (item.mainImage ? 1 : 0),
        };
      })
    : mode === "productList"
      ? []
      : null;

  // Which header carries the bill isn't documented anywhere I can
  // reach, so read the plausible ones and report whichever answers.
  const cost =
    res.headers.get("zyte-request-cost") ??
    res.headers.get("x-request-cost") ??
    res.headers.get("zyte-request-id-cost") ??
    null;

  return {
    ok: true,
    status: res.status,
    content,
    bytes: content.length,
    products,
    cost,
    error: null,
  };
}
