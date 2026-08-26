/**
 * Derive REDFIN_CITY_ID entries from Redfin's public market tracker.
 *
 * The URL for a city's rentals is keyed by an opaque number
 * (`/city/8907/FL/Jacksonville/rentals`) that can't be derived from the
 * name, and the endpoints that hand it out are behind bot protection
 * that costs money to bypass — when it works at all.
 *
 * It turns out we never needed them. Redfin publishes a free, keyless,
 * unauthenticated market-tracker export, and its TABLE_ID column IS
 * that number. Cross-checked against the 242 ids previously harvested a
 * different way (scraping Redfin's own state index pages through a paid
 * proxy), every unambiguous key agreed: 190 of 190, no mismatches.
 *
 *   node scripts/city-ids-from-market-tracker.mjs [--file local.tsv.gz]
 *
 * The download is ~1GB gzipped, so rows are folded into distinct cities
 * as they stream past; nothing is written to disk.
 *
 * Matching is the same verification the app uses — city name whole AND
 * state exact — with one addition that matters more than coverage: a
 * name that maps to MORE THAN ONE id in its state is refused, not
 * guessed. Redfin carries two records for a handful of cities
 * (Louisville KY is both 12262 and 36188), and only two of those
 * overlapped the verified set, which is not enough evidence to justify
 * a tie-break rule. A market with no id says so and moves on; a market
 * with the wrong id would quietly show a different city's rentals under
 * its name, and would look right doing it.
 */

import { createGunzip } from "node:zlib";
import { createReadStream, existsSync } from "node:fs";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { registerHooks } from "node:module";

/**
 * The app's modules import each other the way TypeScript lets them —
 * through the `@/` alias, and without file extensions — and node knows
 * neither convention. Teaching the resolver both rules is cheaper than
 * keeping a second copy of the market list here, which would then be
 * the copy that goes stale.
 */
const ROOT = new URL("../", import.meta.url);
const EXTENSIONS = [".ts", ".tsx", ".js", "/index.ts"];

function resolveTsPath(url) {
  if (existsSync(new URL(url)) || /\.[a-z]+$/i.test(url)) return url;
  for (const ext of EXTENSIONS) {
    if (existsSync(new URL(url + ext))) return url + ext;
  }
  return url;
}

registerHooks({
  resolve(specifier, context, next) {
    const base = specifier.startsWith("@/")
      ? new URL(specifier.slice(2), ROOT).href
      : specifier.startsWith(".") && context.parentURL
        ? new URL(specifier, context.parentURL).href
        : null;
    return next(base === null ? specifier : resolveTsPath(base), context);
  },
});

// Imported after the hook is registered, so `@/` resolves.
const { MARKETS } = await import("../lib/mock/markets.ts");
const { REDFIN_CITY_ID, normalizeCity } = await import(
  "../lib/live/redfin-city.ts"
);

const SOURCE =
  "https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/city_market_tracker.tsv000.gz";

const fileArg = process.argv.indexOf("--file");
const localFile = fileArg === -1 ? null : process.argv[fileArg + 1];

/** Columns we need, by header name — the export has grown before. */
const WANT = ["REGION_TYPE", "TABLE_ID", "CITY", "STATE_CODE"];

const unquote = (s) => s.replace(/^"|"$/g, "");

/**
 * Four of the 23,007 city names carry their own state on the end —
 * "Washington, DC", "Spencer, Ma" — and the trailing state survives
 * normalisation, so those cities match nothing. Dropping a suffix that
 * repeats the row's OWN state code is safe in a way that dropping any
 * trailing comma-part would not be: "Lynchburg, Moore County" keeps its
 * county, because Moore County is not Tennessee.
 *
 * This is what kept the District of Columbia unresolved through every
 * other approach we tried.
 */
function withoutStateSuffix(city, state) {
  const suffix = new RegExp(`,\\s*${state}$`, "i");
  return city.replace(suffix, "").trim();
}

async function source() {
  if (localFile) return createReadStream(localFile);
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`${SOURCE} -> HTTP ${res.status}`);
  return Readable.fromWeb(res.body);
}

/** state → normalized name → Set of ids. A set, so duplicates surface. */
const byState = new Map();
/** The same keys, holding the name as the export actually spelled it,
 *  so a match can report whether normalising was load-bearing. */
const spelling = new Map();
let rows = 0;
let skipped = 0;

const lines = createInterface({
  input: (await source()).pipe(createGunzip()),
  crlfDelay: Infinity,
});

let col = null;
for await (const line of lines) {
  if (col === null) {
    const header = line.split("\t").map(unquote);
    col = Object.fromEntries(WANT.map((name) => [name, header.indexOf(name)]));
    const absent = WANT.filter((name) => col[name] === -1);
    if (absent.length > 0) {
      throw new Error(`export is missing columns: ${absent.join(", ")}`);
    }
    continue;
  }
  const f = line.split("\t");
  rows++;
  if (unquote(f[col.REGION_TYPE] ?? "") !== "place") continue;
  const id = Number(unquote(f[col.TABLE_ID] ?? ""));
  const city = unquote(f[col.CITY] ?? "");
  const state = unquote(f[col.STATE_CODE] ?? "");
  if (!Number.isFinite(id) || id <= 0 || city === "" || state === "") {
    skipped++;
    continue;
  }
  let cities = byState.get(state);
  if (cities === undefined) byState.set(state, (cities = new Map()));
  const plain = withoutStateSuffix(city, state);
  const key = normalizeCity(plain);
  let ids = cities.get(key);
  if (ids === undefined) cities.set(key, (ids = new Set()));
  ids.add(id);
  if (!spelling.has(`${state}|${key}`)) spelling.set(`${state}|${key}`, plain);
}

const resolved = {};
const ambiguous = [];
const absent = [];
/**
 * Markets that matched only because normalising rewrote one of the two
 * names. Worth listing rather than counting: it is the one place a
 * match can be produced by our own string handling rather than by the
 * two sources agreeing, so every entry deserves a look.
 */
const bridged = [];
for (const market of MARKETS) {
  const ids = byState.get(market.stateCode)?.get(normalizeCity(market.name));
  if (ids === undefined) {
    absent.push(`${market.slug} (${market.name}, ${market.stateCode})`);
  } else if (ids.size > 1) {
    ambiguous.push(
      `${market.slug} (${market.name}, ${market.stateCode}): ${[...ids].join(", ")}`
    );
  } else {
    resolved[market.slug] = [...ids][0];
    if (spelling.get(`${market.stateCode}|${normalizeCity(market.name)}`) !== market.name) {
      bridged.push(
        `${market.slug}: "${market.name}" == "${spelling.get(`${market.stateCode}|${normalizeCity(market.name)}`)}"`
      );
    }
  }
}

/**
 * A conflict means one of two independent sources is wrong about a city
 * we already ship. That is worth stopping for, not a line of output.
 */
const conflicts = Object.entries(resolved).filter(
  ([slug, id]) => REDFIN_CITY_ID[slug] !== undefined && REDFIN_CITY_ID[slug] !== id
);
const fresh = Object.keys(resolved).filter((slug) => REDFIN_CITY_ID[slug] === undefined);

const cities = [...byState.values()].reduce((n, m) => n + m.size, 0);
console.log(`rows read:           ${rows}`);
console.log(`rows unusable:       ${skipped}`);
console.log(`distinct cities:     ${cities}`);
console.log(`markets resolved:    ${Object.keys(resolved).length} / ${MARKETS.length}`);
console.log(`  already committed: ${Object.keys(resolved).length - fresh.length}`);
console.log(`  new:               ${fresh.length}`);
console.log(`agreed with committed: ${Object.keys(resolved).length - fresh.length - conflicts.length}`);
console.log(`CONFLICTS:           ${conflicts.length}`);
for (const [slug, id] of conflicts) {
  console.log(`  ! ${slug}: committed ${REDFIN_CITY_ID[slug]} vs export ${id}`);
}

console.log(`\nmatched only after normalising (${bridged.length}):`);
for (const b of bridged) console.log(`  ${b}`);
console.log(`\nrefused, more than one id (${ambiguous.length}):`);
for (const a of ambiguous) console.log(`  ${a}`);
console.log(`\nno row in the export (${absent.length}):`);
for (const a of absent) console.log(`  ${a}`);

console.log(`\n----- new REDFIN_CITY_ID entries (${fresh.length}) -----`);
for (const slug of fresh.sort()) {
  const key = /^[a-z][a-z0-9]*$/.test(slug) ? slug : `"${slug}"`;
  console.log(`  ${key}: ${resolved[slug]},`);
}

if (conflicts.length > 0) process.exitCode = 1;
