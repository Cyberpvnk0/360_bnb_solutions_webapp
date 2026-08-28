/**
 * Mashvisor, as a plain fetch.
 *
 * Here for ONE question: does a licensed feed carry listing photos?
 *
 * Every other source of imagery this product has tried was either a
 * scrape (someone else's terms, someone else's copyright) or absent
 * (the rentals feed carries no imagery in any of its fields). A vendor
 * that licenses its data and ships photo URLs with it would replace
 * both the borrowed pictures and the argument about them.
 *
 * NOTHING HERE IS PINNED TO A SCHEMA YET. Their docs are not reachable
 * from this environment, so the shape of a listing row is unknown and
 * this file does not pretend otherwise: it can call an arbitrary path
 * and describe what came back. Guessing a path and a field list from
 * memory is exactly how three AirROI mappers got written against a
 * payload that did not exist, and each one cost an afternoon. Measure
 * first; map second.
 *
 * Same posture as every other vendor in lib/live: no SDK, key from
 * server-only env, tolerant reading of whatever comes back.
 */

const BASE = "https://api.mashvisor.com/v1.1/client";
const TIMEOUT_MS = 30_000;

/** Every spelling this key might have been saved under. Names are
 *  cheap; a silent miss because the variable was called something
 *  reasonable-but-different costs an afternoon. */
const KEY_NAMES = [
  "MASH_KEY",
  "MASHVISOR_API_KEY",
  "MASHVISOR_KEY",
  "MASH_API_KEY",
] as const;

function apiKey(): string | null {
  for (const name of KEY_NAMES) {
    const value = process.env[name];
    if (value) return value;
  }
  return null;
}

export function hasMashvisorKey(): boolean {
  return apiKey() !== null;
}

/** Which MASH-prefixed names this deployment can see. Names only,
 *  never values — a diagnostic that prints a key is worse than the
 *  confusion it clears up. */
export function mashvisorKeyNamesSeen(): string[] {
  return Object.keys(process.env)
    .filter((k) => /^MASH/i.test(k))
    .sort();
}

export function mashvisorKeyMissingMessage(): string {
  return `no Mashvisor key. Looked for ${KEY_NAMES.join(", ")}; this deployment has ${
    mashvisorKeyNamesSeen().join(", ") || "no MASH* variables at all"
  }`;
}

export interface MashvisorResponse {
  ok: boolean;
  status: number;
  /** Parsed JSON, when it was JSON. */
  body: unknown;
  /** What the service said when it refused. Validation prose, safe to
   *  surface, and the whole point of asking. */
  error: string | null;
}

/**
 * One call. Path is relative to the client base, e.g. "/rental-rates".
 *
 * A 200 is not success: their layer can answer 200 with a failure
 * inside the body, which is a distinction that has already cost a day
 * elsewhere in this codebase. The caller gets both.
 */
export async function mashvisorCall(
  path: string,
  params: Record<string, string> = {}
): Promise<MashvisorResponse> {
  const key = apiKey();
  if (!key) {
    return { ok: false, status: 0, body: null, error: mashvisorKeyMissingMessage() };
  }

  const clean = path.startsWith("/") ? path : `/${path}`;
  const query = new URLSearchParams(params).toString();
  const url = `${BASE}${clean}${query ? `?${query}` : ""}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "x-api-key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, body: null, error: "network or timeout" };
  }

  const text = await res.text().catch(() => "");
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    return {
      ok: false,
      status: res.status,
      body: null,
      error: `not JSON: ${text.replace(/\s+/g, " ").slice(0, 200)}`,
    };
  }

  return {
    ok: res.ok,
    status: res.status,
    body,
    error: res.ok ? null : text.replace(/\s+/g, " ").slice(0, 300),
  };
}

/* ------------------------------------------------------------------ */
/* The actual question: are there pictures in here?                    */
/* ------------------------------------------------------------------ */

/** A URL that ends in an image extension, query string allowed. */
const IMAGE_URL = /^https?:\/\/[^\s"']+\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i;
/** A field whose NAME promises a picture, whatever the value looks
 *  like — CDNs routinely serve images from extensionless paths. */
const IMAGE_KEY = /(?:^|[._[])(?:photo|photos|image|images|img|imgs|media|thumbnail|thumb|picture|pictures)s?(?:$|[._[\]])/i;

export interface ImageField {
  /** Dotted path with array indices collapsed, e.g. "results[].photos[]". */
  path: string;
  /** How many values were found at this path across the sample. */
  count: number;
  /** One real URL, so somebody can paste it in a browser and look. A
   *  field that reports twelve photos and serves twelve 403s is not a
   *  photo source, and only opening one tells you which you have. */
  sample: string;
}

/** Array indices collapsed, so forty photos are one row and not forty. */
function collapse(path: string): string {
  return path.replace(/\[\d+\]/g, "[]");
}

/**
 * Every image URL in a payload, grouped by where it lives.
 *
 * The one function in this file worth writing before the schema is
 * known: it answers "are there pictures in here" without needing to be
 * told what the vendor calls them. A field named `photos` holding
 * extensionless CDN links counts, and so does a field named `cover`
 * holding a .jpg — either alone would miss real answers.
 */
export function imageFieldsIn(value: unknown, maxDepth = 8): ImageField[] {
  const found = new Map<string, { count: number; sample: string }>();

  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > maxDepth || found.size > 60) return;

    if (typeof node === "string") {
      const looksLikeUrl = /^https?:\/\//i.test(node);
      if (!looksLikeUrl) return;
      // Either the value is plainly an image, or the field it sits
      // under promised one. Both, because either test alone misses a
      // real answer that the other catches.
      if (!IMAGE_URL.test(node) && !IMAGE_KEY.test(path)) return;
      const key = collapse(path) || "(root)";
      const hit = found.get(key);
      if (hit) hit.count += 1;
      else found.set(key, { count: 1, sample: node.slice(0, 300) });
      return;
    }

    if (Array.isArray(node)) {
      // Only the first few elements: a hundred listings each with a
      // dozen photos is twelve hundred identical findings.
      for (const [i, item] of node.slice(0, 5).entries()) {
        walk(item, `${path}[${i}]`, depth + 1);
      }
      return;
    }

    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k, depth + 1);
      }
    }
  };

  walk(value, "", 0);
  return [...found.entries()]
    .map(([path, { count, sample }]) => ({ path, count, sample }))
    .sort((a, b) => b.count - a.count);
}
