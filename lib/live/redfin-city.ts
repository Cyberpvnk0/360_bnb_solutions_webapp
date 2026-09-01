/**
 * Redfin city ids.
 *
 * Redfin addresses a city by an opaque number in its URL path
 * (`/city/8907/FL/Jacksonville/rentals`) that cannot be derived from the
 * name. Without one, a market simply has no Redfin search — and the
 * failure mode to avoid is not "no results", it is confidently showing
 * Jackson, Mississippi's rentals under Jacksonville, Florida.
 *
 * So resolution is lazy and VERIFIED: ask Redfin's own location
 * autocomplete, then refuse any answer whose name and state don't match
 * the market we asked about. A market we can't resolve keeps saying so.
 *
 * Ids never change, so a resolved one is cached for a year and every
 * later search rides it for free.
 */

import { readCityId, writeCityId } from "@/lib/db/market-store";
import type { Market } from "@/lib/mock/types";

const AUTOCOMPLETE =
  "https://www.redfin.com/stingray/do/location-autocomplete";
const SCRAPER = "https://api.scraperapi.com/";

/** A city id is permanent; only a redeploy should ever re-ask. */
export const CITY_ID_REVALIDATE_SECONDS = 31_536_000;

/**
 * Request tiers for the autocomplete call.
 *
 * The structured Redfin endpoints handle bot protection internally,
 * which is why the search and listing calls need nothing. This one goes
 * through ScraperAPI's PLAIN endpoint, and redfin.com is a protected
 * domain there: the standard tier answers with "Protected domains may
 * require adding premium=true OR ultra_premium=true".
 *
 * Standard is NOT in the ladder: it has already been measured failing on
 * this exact domain, so trying it first spends twenty seconds of a
 * sixty-second budget learning what we know. A bypass request on a
 * protected domain is slow, and three of them in series is how this
 * route first returned a 504 rather than an answer.
 */
const TIERS: { name: string; params: Record<string, string> }[] = [
  { name: "premium", params: { premium: "true" } },
  { name: "ultra", params: { ultra_premium: "true" } },
];

/** Per-attempt ceiling. Two attempts have to fit inside the route's own
 *  budget with room to answer, however slow the upstream is. */
const ATTEMPT_TIMEOUT_MS = 20_000;

/**
 * Known ids, seeded from real URLs. A static entry costs nothing and is
 * always preferred; everything else resolves on first use.
 */
/**
 * Where the listing site's URL path uses a different name than we do.
 *
 * The path segment is usually cosmetic next to the id, but three of
 * these are cities filed under another name entirely — Berkeley
 * Springs is incorporated as Bath, Augusta is the consolidated
 * Augusta-Richmond county government, Eagle Mountain Lake's page is
 * just Eagle Mountain. Those are also exactly the rows the public
 * export had no entry for, because it indexes by the official name and
 * we ask by the common one.
 *
 * Only the exceptions live here; everything else uses the market name.
 */
export const REDFIN_CITY_PATH: Record<string, string> = {
  "augusta-ga": "Augusta-Richmond",
  "berkeley-springs": "Bath",
  "eagle-mountain-lake": "Eagle-Mountain",
};

export const REDFIN_CITY_ID: Record<string, number> = {
  // Discovered in bulk from Redfin's state index pages via
  // /api/redfin/cities. Every entry matched on city name AND state.
  anchorage: 781,
  "augusta-ga": 36058,
  bailey: 38798,
  bentonville: 1423,
  "berkeley-springs": 1288,
  "bethany-beach": 1517,
  birmingham: 1823,
  boulder: 2025,
  brownsville: 2776,
  "cape-coral": 2654,
  "carlsbad-nm": 3144,
  "cave-creek": 2922,
  "cedar-key": 2902,
  clearwater: 3344,
  "colorado-springs": 4147,
  corvallis: 4092,
  "cripple-creek": 4797,
  denver: 5155,
  "eagle-mountain-lake": 22487,
  elizabethtown: 6247,
  ellijay: 6933,
  "eureka-springs": 5727,
  "fayetteville-ar": 6011,
  flagstaff: 6089,
  "fort-collins": 7006,
  "fort-lauderdale": 6173,
  "fort-myers": 6208,
  "gainesville-fl": 6487,
  glendale: 7102,
  "gulf-shores": 8244,
  hartford: 9406,
  "hot-springs": 8549,
  "huntington-beach": 9164,
  huntsville: 9408,
  jacksonville: 8907,
  juneau: 9265,
  kissimmee: 9399,
  "lake-havasu-city": 10002,
  "little-rock": 10455,
  "logan-oh": 11381,
  "logan-ut": 11698,
  "long-beach": 10940,
  "longboat-key": 10482,
  "los-angeles": 11203,
  mesa: 11736,
  miami: 11458,
  mobile: 12836,
  montgomery: 13134,
  mystic: 24468,
  naples: 12171,
  "new-haven": 13410,
  "orange-beach": 14804,
  orlando: 13655,
  pensacola: 14479,
  phoenix: 14240,
  prescott: 14874,
  "rehoboth-beach": 15565,
  sacramento: 16409,
  "san-diego": 16904,
  "san-francisco": 17151,
  "santa-clarita": 17676,
  sarasota: 16463,
  scottsdale: 16660,
  sedona: 16757,
  seward: 17568,
  "siesta-key": 25613,
  "spring-hill": 25768,
  stamford: 18605,
  "st-augustine": 16053,
  "st-petersburg": 16164,
  "stone-mountain": 18770,
  tampa: 18142,
  temecula: 19701,
  tempe: 18607,
  tucson: 19459,
  tuscaloosa: 19514,
  "vero-beach": 18840,
  "west-palm-beach": 19373,
  "wilmington-de": 19583,
  atlanta: 30756,
  indianapolis: 9170,
  savannah: 17651,
  honolulu: 34945,
  kihei: 9293,
  lahaina: 10924,
  princeville: 16688,
  "cedar-rapids": 3103,
  "des-moines": 5415,
  dubuque: 5768,
  "iowa-city": 9788,
  boise: 2287,
  "coeur-d-alene": 4370,
  "idaho-falls": 10107,
  mccall: 12489,
  sandpoint: 18403,
  "sun-valley": 19849,
  chicago: 29470,
  naperville: 29501,
  bloomington: 1558,
  "fort-wayne": 6438,
  "south-bend": 18137,
  lawrence: 9865,
  "overland-park": 13896,
  topeka: 18143,
  wichita: 19878,
  "bowling-green": 2307,
  covington: 4618,
  lexington: 11746,
  louisville: 12262,
  paducah: 15227,
  "baton-rouge": 1336,
  lafayette: 10392,
  "lake-charles": 10485,
  "new-orleans": 14233,
  shreveport: 17884,
  bangor: 735,
  "bar-harbor": 21265,
  camden: 21714,
  kennebunkport: 23484,
  "portland-me": 15614,
  "las-vegas": 10201,
  boston: 1826,
  annapolis: 409,
  baltimore: 1073,
  frederick: 7735,
  "ocean-city-md": 15083,
  "ann-arbor": 782,
  detroit: 5665,
  "grand-rapids": 8694,
  holland: 9801,
  "traverse-city": 20162,
  duluth: 4430,
  minneapolis: 10943,
  "rochester-mn": 14201,
  "st-paul": 15027,
  branson: 2056,
  "columbia-mo": 4058,
  "kansas-city": 35751,
  "springfield-mo": 17886,
  "st-louis": 16661,
  biloxi: 1643,
  gulfport: 7572,
  "jackson-ms": 9165,
  oxford: 14188,
  "big-sky": 21480,
  billings: 1720,
  bozeman: 2317,
  helena: 9065,
  kalispell: 10220,
  missoula: 12893,
  whitefish: 20056,
  "grand-island": 5049,
  kearney: 6447,
  "lincoln-ne": 7163,
  omaha: 9417,
  hanover: 23296,
  laconia: 10243,
  manchester: 11504,
  "north-conway": 24762,
  portsmouth: 16139,
  "boulder-city": 1712,
  "carson-city": 2499,
  henderson: 8147,
  "north-las-vegas": 13363,
  reno: 15627,
  columbus: 4664,
  cleveland: 4145,
  cincinnati: 3879,
  dayton: 5413,
  akron: 244,
  charlotte: 3105,
  durham: 4909,
  "fayetteville-nc": 5903,
  greensboro: 7161,
  raleigh: 35711,
  "wilmington-nc": 18894,
  "winston-salem": 19017,
  bismarck: 1876,
  fargo: 6610,
  "cape-may": 2652,
  "jersey-city": 9168,
  "ocean-city-nj": 14076,
  princeton: 15686,
  albuquerque: 513,
  "las-cruces": 10005,
  roswell: 16643,
  ruidoso: 16721,
  "santa-fe": 18007,
  taos: 19288,
  albany: 245,
  buffalo: 2832,
  "new-york": 30749,
  "rochester-ny": 16162,
  syracuse: 18606,
  toledo: 19458,
  "broken-bow": 2358,
  norman: 13526,
  "oklahoma-city": 14237,
  stillwater: 17962,
  tulsa: 35765,
  bend: 1543,
  eugene: 6142,
  "portland-or": 30772,
  "salem-or": 30778,
  allentown: 514,
  harrisburg: 8380,
  lancaster: 10496,
  philadelphia: 15502,
  pittsburgh: 15702,
  narragansett: 35741,
  newport: 12826,
  providence: 15272,
  "san-antonio": 16657,
  dallas: 30794,
  "fort-worth": 30827,
  austin: 30818,
  houston: 8903,
  nashville: 13415,
  memphis: 12260,
  chattanooga: 3641,
  knoxville: 10200,
  "myrtle-beach": 12572,
  "charleston-sc": 3478,
  "columbia-sc": 4149,
  greenville: 7891,
  "hilton-head-island": 8702,
  spartanburg: 17499,
  custer: 3915,
  deadwood: 4066,
  "rapid-city": 13643,
  "sioux-falls": 15282,
  franklin: 7080,
  "round-rock": 30823,
  ogden: 14490,
  "park-city": 15045,
  provo: 16042,
  "salt-lake-city": 17150,
  "st-george": 16751,
  "alexandria-va": 250,
  norfolk: 14757,
  richmond: 17149,
  "virginia-beach": 20418,
  brattleboro: 21592,
  burlington: 2749,
  ludlow: 10492,
  stowe: 34887,
  woodstock: 20923,
  bellingham: 1411,
  olympia: 13223,
  seattle: 16163,
  tacoma: 17887,
  vancouver: 18823,
  "green-bay": 7928,
  "lake-geneva": 10563,
  madison: 12257,
  milwaukee: 35759,
  "charleston-wv": 3787,
  "harpers-ferry": 8978,
  morgantown: 14431,
  casper: 3428,
  cheyenne: 3616,
  cody: 4082,
  "jackson-wy": 10231,
  laramie: 11475,

  // Derived from Redfin's free public market-tracker export, whose
  // TABLE_ID column is this same city id — see
  // scripts/city-ids-from-market-tracker.mjs. The export and the state
  // pages above are wholly independent sources, and on the 221 markets
  // they both cover they agreed on every single id, which is what makes
  // these safe to ship unseen. A city the export lists twice is refused
  // rather than guessed, so a few markets stay unresolved on purpose.
  abilene: 243,
  "alexandria-mn": 217,
  amarillo: 779,
  anaheim: 517,
  "asbury-park": 501,
  ashland: 803,
  aspen: 983,
  "atlantic-city": 538,
  "augusta-me": 543,
  bakersfield: 953,
  bemidji: 1347,
  "big-bear-lake": 1692,
  boone: 1847,
  brainerd: 1906,
  breckenridge: 2171,
  "bryson-city": 2199,
  "cannon-beach": 2795,
  champaign: 3210,
  charlottesville: 3867,
  chelan: 3007,
  cloudcroft: 4231,
  "cocoa-beach": 3436,
  "college-station": 4134,
  davenport: 4283,
  "daytona-beach": 4302,
  denton: 5145,
  destin: 4501,
  durango: 5678,
  edgartown: 36110,
  "el-paso": 6171,
  erie: 6172,
  "estes-park": 6463,
  evansville: 5667,
  "folly-beach": 6678,
  fredericksburg: 6986,
  fresno: 6904,
  "front-royal": 7639,
  galveston: 7178,
  gatlinburg: 7339,
  gettysburg: 7372,
  "grand-junction": 8093,
  hendersonville: 7853,
  hudson: 9155,
  "joshua-tree": 23536,
  "kailua-kona": 5933,
  "key-largo": 23460,
  "key-west": 9311,
  "kill-devil-hills": 9095,
  killeen: 9939,
  "la-crosse": 10404,
  lansing: 11731,
  leavenworth: 9847,
  "lincoln-city": 10840,
  "lincoln-nh": 33502,
  lubbock: 11455,
  mcallen: 11570,
  medford: 11999,
  montauk: 24327,
  monterey: 12514,
  napa: 12914,
  "new-braunfels": 13081,
  "niagara-falls": 13156,
  "ocean-shores": 13014,
  oceanside: 13753,
  okoboji: 15200,
  oxnard: 14141,
  page: 13365,
  "palm-desert": 14294,
  "palm-springs": 14315,
  "panama-city-beach": 14163,
  peoria: 15268,
  "pigeon-forge": 15051,
  "port-angeles": 14339,
  pueblo: 15932,
  "put-in-bay": 16672,
  roanoke: 17419,
  rockford: 16655,
  "salem-ma": 15302,
  "san-luis-obispo": 17464,
  sandusky: 17984,
  "santa-barbara": 17669,
  "santa-cruz": 17680,
  "saratoga-springs": 16733,
  saugatuck: 18313,
  scranton: 17652,
  seaside: 16890,
  sevierville: 17180,
  "south-lake-tahoe": 18630,
  "south-padre-island": 17686,
  spokane: 17154,
  springdale: 18342,
  "springfield-il": 18387,
  "springfield-ma": 17155,
  "state-college": 18769,
  "steamboat-springs": 18775,
  stroudsburg: 18984,
  tallahassee: 18046,
  truckee: 20216,
  tyler: 18838,
  vail: 20103,
  waco: 19250,
  "walla-walla": 19187,
  "west-yellowstone": 19989,
  wildwood: 20315,
  williamsburg: 20946,
  "wisconsin-dells": 21087,
  worcester: 20420,
  yuma: 20893,

  // The District, which every other route missed. The export writes its
  // city as the literal string "Washington, DC", and the trailing state
  // survives normalising, so the name matched nothing — the one market
  // with no state index page of its own, unresolved for the dullest
  // possible reason.
  washington: 12839,
  zephyrhills: 19928,
};

/** Comparable form: case, punctuation and "saint" all vary between
 *  our market names and Redfin's. */
export function normalizeCity(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bst\.?\b/g, "saint")
    .replace(/\bft\.?\b/g, "fort")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Parse JSON behind an XSSI guard.
 *
 * Redfin prefixes its internal JSON with `{}&&`. Reaching for the first
 * `{` finds the guard's OWN empty object and hands JSON.parse the string
 * `{}&&{"version":…}`, which throws — so the payload silently became
 * null and every market resolved to "no confident match". The guard has
 * to be stripped as a guard, not searched past.
 */
const XSSI_GUARDS = [
  /^\{\}&&/,
  /^\)\]\}'?,?\s*/,
  /^for\s*\(\s*;\s*;\s*\)\s*;/,
  /^while\s*\(1\)\s*;/,
];

export function parseGuardedJson(text: string): unknown {
  let body = text.trim();
  for (const guard of XSSI_GUARDS) body = body.replace(guard, "").trim();
  try {
    return JSON.parse(body);
  } catch {
    // An unrecognised guard: fall back to the first brace that yields
    // valid JSON, rather than assuming the first brace is the payload.
    for (let i = body.indexOf("{"); i >= 0; i = body.indexOf("{", i + 1)) {
      try {
        return JSON.parse(body.slice(i));
      } catch {
        continue;
      }
    }
    return null;
  }
}

interface Candidate {
  id: number;
  name: string;
  state: string;
}

/**
 * Every city-looking row in an autocomplete payload.
 *
 * Schema-tolerant by necessity — this is an internal endpoint with no
 * contract. Rows are recognised by carrying an id that looks like
 * `{type}_{number}` alongside a name, wherever they sit.
 */
export function extractCandidates(
  value: unknown,
  depth = 0,
  out: Candidate[] = []
): Candidate[] {
  if (depth > 8 || out.length > 60) return out;
  if (Array.isArray(value)) {
    for (const v of value) extractCandidates(v, depth + 1, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;

  const row = value as Record<string, unknown>;
  const rawId = row.id ?? row.rowId;
  const name =
    typeof row.name === "string"
      ? row.name
      : typeof row.city === "string"
        ? row.city
        : undefined;

  if (typeof rawId === "string" && name) {
    // "6_8907" — the trailing number is the city id.
    const id = Number(rawId.split("_").pop());
    if (Number.isFinite(id) && id > 0) {
      const state =
        typeof row.market === "string"
          ? row.market
          : typeof row.state === "string"
            ? row.state
            : typeof row.stateCode === "string"
              ? row.stateCode
              : "";
      out.push({ id, name, state });
    }
  }

  for (const v of Object.values(row)) extractCandidates(v, depth + 1, out);
  return out;
}

/**
 * The candidate that is unambiguously OUR city.
 *
 * A name match alone is not enough: Springfield exists in dozens of
 * states, and Jacksonville, FL and Jackson, MS are one fuzzy match
 * apart. Both the city and its state must line up, and the name is
 * compared whole rather than by prefix.
 */
export function pickCandidate(
  candidates: readonly Candidate[],
  market: Market
): number | null {
  const wantCity = normalizeCity(market.name);
  const wantState = market.stateCode.toLowerCase();

  for (const c of candidates) {
    if (normalizeCity(c.name) !== wantCity) continue;
    const haystack = `${c.name} ${c.state}`.toLowerCase();
    // The state has to appear as its own token, or "MI" matches "Miami".
    if (new RegExp(`\\b${wantState}\\b`).test(haystack)) return c.id;
  }
  return null;
}

/** Everything a failed resolution needs to explain itself. */
export interface CityIdProbe {
  cityId: number | null;
  autocompleteUrl: string;
  status: number | null;
  /** Which tier finally answered, and which were attempted. */
  tier?: string;
  tiersTried?: string[];
  parsed: boolean;
  bytes: number;
  /** First characters of the response, so an unrecognised XSSI guard or
   *  a block page is visible rather than guessed at. */
  head: string;
  candidates: Candidate[];
}

/**
 * Resolve, and report every step. Used by the setup probe so a null
 * answer distinguishes "blocked", "shape changed" and "matched nothing".
 */
export async function probeCityId(market: Market): Promise<CityIdProbe> {
  const autocompleteUrl = autocompleteFor(market);
  const empty: CityIdProbe = {
    cityId: null,
    autocompleteUrl,
    status: null,
    parsed: false,
    bytes: 0,
    head: "",
    candidates: [],
  };
  const key = process.env.SCRAPERAPI_KEY;
  if (!key) return empty;

  try {
    const { attempt, body, tried } = await fetchAutocomplete(
      autocompleteUrl,
      key
    );
    const candidates = extractCandidates(body);
    return {
      cityId: pickCandidate(candidates, market),
      autocompleteUrl,
      status: attempt.status,
      tier: attempt.tier,
      tiersTried: tried,
      parsed: body !== null,
      bytes: attempt.text.length,
      head: attempt.text.slice(0, 220),
      candidates: candidates.slice(0, 12),
    };
  } catch {
    return empty;
  }
}

interface Attempt {
  tier: string;
  status: number;
  text: string;
}

/** Climb the tiers until one returns something that parses. Returns the
 *  last attempt when none do, so the caller can report what happened. */
async function fetchAutocomplete(
  target: string,
  key: string
): Promise<{ attempt: Attempt; body: unknown; tried: string[] }> {
  const tried: string[] = [];
  let last: Attempt = { tier: "none", status: 0, text: "" };

  for (const tier of TIERS) {
    tried.push(tier.name);
    const params = new URLSearchParams({
      api_key: key,
      url: target,
      ...tier.params,
    });
    let res: Response;
    try {
      res = await fetch(`${SCRAPER}?${params}`, {
        next: { revalidate: CITY_ID_REVALIDATE_SECONDS },
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
    } catch {
      // A tier that hangs is a tier that failed; give the next one its
      // own budget rather than letting one stall the whole request.
      last = { tier: tier.name, status: 408, text: "attempt timed out" };
      continue;
    }
    const text = await res.text();
    last = { tier: tier.name, status: res.status, text };
    if (!res.ok) continue;
    const body = parseGuardedJson(text);
    if (body !== null) return { attempt: last, body, tried };
  }
  return { attempt: last, body: null, tried };
}

function autocompleteFor(market: Market): string {
  return `${AUTOCOMPLETE}?${new URLSearchParams({
    location: `${market.name}, ${market.stateCode}`,
    start: "0",
    count: "10",
    v: "2",
  })}`;
}

/**
 * A single premium-tier autocomplete lookup, for bulk use.
 *
 * The state index pages list a state's larger cities and skip the small
 * resort towns — Aspen, Key West, Gatlinburg, Moab — so those have to be
 * asked for by name. Leaner than the diagnostic path on purpose: one
 * tier, one timeout, so dozens can run inside a single request.
 */
export interface OnceResult {
  id: number | null;
  status: number;
  /** First characters of the response — the only way to tell a block
   *  page from a payload whose shape we misread. */
  head: string;
  candidates: number;
}

export async function resolveCityIdOnce(
  market: Market,
  key: string,
  timeoutMs = 28_000
): Promise<OnceResult> {
  // A 429 is the vendor's thread limit, not a verdict on the city, so
  // it earns one patient retry. A premium fetch on a protected domain
  // routinely takes twenty seconds; the first cut of this gave it
  // fifteen and then called seven timeouts a result.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const params = new URLSearchParams({
        api_key: key,
        url: autocompleteFor(market),
        premium: "true",
      });
      const res = await fetch(`${SCRAPER}?${params}`, {
        next: { revalidate: CITY_ID_REVALIDATE_SECONDS },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (res.status === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 2_500));
        continue;
      }
      if (!res.ok) {
        return {
          id: null,
          status: res.status,
          head: text.slice(0, 180),
          candidates: 0,
        };
      }
      const found = extractCandidates(parseGuardedJson(text));
      return {
        id: pickCandidate(found, market),
        status: res.status,
        head: text.slice(0, 180),
        candidates: found.length,
      };
    } catch {
      if (attempt === 0) continue;
      return { id: null, status: 408, head: "attempt timed out", candidates: 0 };
    }
  }
  return { id: null, status: 429, head: "rate limited", candidates: 0 };
}

/** Resolved this run, so one market never resolves twice per instance. */
const resolved = new Map<string, number | null>();

/** Tests only. */
export function resetCityIdCache(): void {
  resolved.clear();
}

/**
 * This market's Redfin city id, or null if we can't be sure of one.
 *
 * Four tiers, cheapest first:
 *
 *   1. the static map — free, and covers the markets already committed
 *   2. this instance's memory — free, and covers a repeat within one
 *      warm lambda
 *   3. the durable store — one fast database read, and covers every
 *      other instance and every later deploy
 *   4. Redfin's own autocomplete — slow, billed, and the only tier that
 *      can learn something new
 *
 * Tier 3 is the one that makes the Furnished filter dependable rather
 * than merely possible. Without it a resolved id lived only in the
 * lambda that resolved it, so the two hundred and fifty-odd markets
 * outside the static map re-bought the same slow answer on every deploy
 * and every cold start — which reads, from a student's chair, as a
 * filter that sometimes works.
 *
 * Null is a real answer and gets stored as one: the caller reports that
 * the market isn't wired up rather than searching a city we merely hope
 * is right.
 */
export async function cityIdFor(market: Market): Promise<number | null> {
  const seeded = REDFIN_CITY_ID[market.slug];
  if (seeded !== undefined) return seeded;

  const cached = resolved.get(market.slug);
  if (cached !== undefined) return cached;

  // A remembered miss counts. Treating {id: null} as "nothing stored"
  // would re-run the slow lookup for every market Redfin does not have,
  // every time, which is the exact cost the store exists to remove.
  const stored = await readCityId(market.slug).catch(() => null);
  if (stored) {
    resolved.set(market.slug, stored.id);
    return stored.id;
  }

  const key = process.env.SCRAPERAPI_KEY;
  if (!key) return null;

  const target = autocompleteFor(market);

  let id: number | null = null;
  try {
    const { body } = await fetchAutocomplete(target, key);
    id = pickCandidate(extractCandidates(body), market);
  } catch {
    // An unreachable resolver is an unwired market, not an error to
    // propagate: the search above it already knows how to say so.
    //
    // Deliberately NOT stored. A network failure is not evidence about
    // whether Redfin has this city, and writing it as a miss would sell
    // one bad night as a week of a broken filter.
    resolved.set(market.slug, null);
    return null;
  }

  resolved.set(market.slug, id);
  // Both outcomes are worth keeping: a hit for a year, a miss for a
  // week. Never let a storage failure cost the answer we just bought.
  await writeCityId(market.slug, id).catch(() => {});
  return id;
}
