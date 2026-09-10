/**
 * What the assistant can reach for.
 *
 * Two of Anthropic's own: the web, searched and read on their side
 * (nothing runs here, nothing is proxied). And one of ours: the
 * listing-page finder the "View photos" button already uses, which
 * asks the two big portals for the exact address and only ever
 * returns a page whose path spells it. The model is told to try ours
 * first — a verified page beats a search result — and to search the
 * web after.
 *
 * The web tools are called directly rather than through the filtering
 * container: a chat answer is waiting on them, and a container's
 * start-up is seconds the person can feel.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { addressSearchHref, siteSearchHref, zillowHref, type Addressed } from "@/lib/live/listing-links";
import { resolveListingPage } from "@/lib/live/redfin-page";
import { checkZillow } from "@/lib/live/zillow-page";

export const FIND_LISTING_PAGES = "find_listing_pages";
/** Searches and reads one message may spend: enough to settle a
 *  question, not enough to wander. */
export const SEARCH_USES = 6;
export const FETCH_USES = 4;
export const FETCH_TOKENS = 20_000;

export function assistantTools(): Anthropic.ToolUnion[] {
  return [
    {
      type: "web_search_20260318",
      name: "web_search",
      max_uses: SEARCH_USES,
      allowed_callers: ["direct"],
    },
    {
      type: "web_fetch_20260318",
      name: "web_fetch",
      max_uses: FETCH_USES,
      max_content_tokens: FETCH_TOKENS,
      allowed_callers: ["direct"],
    },
    {
      name: FIND_LISTING_PAGES,
      description:
        "Verified listing pages for a rental address on the major listing portals, plus ready-made search links for the others. Returns JSON: `verified` pages carry this exact address in their URL; `searches` are links that may land on it. Call this before searching the web for a listing.",
      input_schema: {
        type: "object",
        properties: {
          address: { type: "string", description: "The street line only, e.g. \"2262 Kingston St\" or \"1107 W Arch St Apt A\"." },
          city: { type: "string" },
          state: { type: "string", description: "Two-letter state code, e.g. FL." },
          zip: { type: "string", description: "Five digits, when known." },
        },
        required: ["address", "city", "state"],
        additionalProperties: false,
      },
    },
  ];
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

function readPlace(input: unknown): Addressed | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const address = str(raw.address, 200);
  const city = str(raw.city, 100);
  const state = str(raw.state ?? raw.stateCode, 2)?.toUpperCase() ?? null;
  if (!address || !city || !state || !/^[A-Z]{2}$/.test(state)) return null;
  const zip = str(raw.zip, 5);
  return { address, city, stateCode: state, ...(zip && /^\d{5}$/.test(zip) ? { zip } : {}) };
}

/** Our one tool, run here. Never throws: a failure is a result the
 *  model reads, not a request that dies. */
export async function runTool(name: string, input: unknown): Promise<ToolOutcome> {
  if (name !== FIND_LISTING_PAGES) {
    return { content: `No tool named ${name}.`, isError: true };
  }
  const place = readPlace(input);
  if (!place) {
    return { content: "address, city and a two-letter state are required.", isError: true };
  }
  const [redfin, zillow] = await Promise.all([
    resolveListingPage(place, { fast: true }).catch(() => null),
    checkZillow(place).catch(() => null),
  ]);
  const verified: { site: string; url: string }[] = [];
  if (redfin?.url) verified.push({ site: "Redfin", url: redfin.url });
  if (zillow?.kind === "page") verified.push({ site: "Zillow", url: zillow.url });

  const searches: { site: string; url: string; note: string }[] = [];
  if (zillow?.kind !== "page") {
    const z = zillowHref(place);
    if (z) {
      searches.push({
        site: "Zillow",
        url: z,
        note:
          zillow?.kind === "none"
            ? "Zillow's address search; Zillow did not have a page for this exact address just now"
            : "Zillow's address search; opens the home's page when Zillow has one",
      });
    }
  }
  const realtor = siteSearchHref(place, "realtor.com");
  if (realtor) searches.push({ site: "Realtor", url: realtor, note: "a search of the site for the address" });
  const images = addressSearchHref(place);
  if (images) searches.push({ site: "Google Images", url: images, note: "pictures of the address" });

  return {
    content: JSON.stringify({
      address: `${place.address}, ${place.city}, ${place.stateCode}${place.zip ? ` ${place.zip}` : ""}`,
      verified,
      searches,
      note:
        verified.length > 0
          ? "Verified pages carry this exact address in their URL."
          : "No portal page was verified for this exact address; the search links may still land on it, and a web search with the address quoted may find it on another site.",
    }),
    isError: false,
  };
}
